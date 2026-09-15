"""VLU transcript -> structured JSON. Native PDF first, OCR fallback.

Run: .venv/Scripts/python.exe test_ocr.py [file.pdf]
Default OCR fallback: PP-OCRv5 line detection + fine-tuned Vietnamese recogniser
(training/output/F3_frozen_lr1e-3/inference) at 150 DPI, see ppocr_table.py.
Optional: --mode ocr --rec-model-dir training/output/<run>/inference
Optional: --engine vl --dpi 300 --rows-per-crop 2 --max-pixels 200704 (PaddleOCR-VL 1.6)
Optional: --catalog courses.json (object mapping course codes to names).
Adapter expects the supplied VLU eight-column table layout.
"""
import argparse
from collections import Counter
from dataclasses import dataclass
from difflib import get_close_matches
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import unicodedata
import pymupdf

ROOT = Path(__file__).resolve().parent
CODE = re.compile(r'\b\d{2}[A-Z]{2,10}\d{5,8}\b')
# Best model of training/BAO_CAO_OCR.md; 150 DPI was the most stable setting in pipeline tuning.
DEFAULT_REC_MODEL = ROOT / 'models/f3'
DEFAULT_DPI = {'ppocr': 150, 'vl': 300}
DEFAULT_DET_MODEL = 'PP-OCRv5_server_det'
PASS_LETTERS = {'A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D'}
RESULT_MARKS = {'✓': 'passed', '✗': 'failed'}  # written into the result cell by ppocr_table.result_mark
RESULT_WORDS = {'dat': 'passed', 'dau': 'passed', 'khong dat': 'failed', 'rot': 'failed', 'truot': 'failed'}
# Conditional courses (national defence, physical education) are excluded from the semester GPA.
CONDITIONAL_PREFIXES = ('71NAD', '71PE')
RANKS = {'xuat sac': ('Xuất sắc', 'excellent'), 'gioi': ('Giỏi', 'very_good'), 'kha': ('Khá', 'good'),
         'trung binh': ('Trung bình', 'average'), 'yeu': ('Yếu', 'weak'), 'kem': ('Kém', 'poor')}
# Folded summary label -> (field, kind, upper bound). Most specific labels first.
SUMMARY_FIELDS = [
    ('so tin chi dat hoc ky', 'semester_credits_passed', 'int', None),
    ('diem tb hoc ky (he 4)', 'semester_gpa_4', 'float', 4),
    ('diem tb hoc ky (he 10)', 'semester_gpa_10', 'float', 10),
    ('xep loai hoc tap hk', 'semester_rank', 'rank', None),
    ('diem ren luyen hoc ky', 'conduct_score', 'int', 100),
    ('tong so tin chi dang ky', 'registered_credits_total', 'int', None),
    ('diem tb hoc tap (he 4)', 'study_gpa_4', 'float', 4),
    ('diem tb hoc tap (he 10)', 'study_gpa_10', 'float', 10),
    ('tong so tin chi tich luy', 'cumulative_credits', 'int', None),
    ('diem tb tich luy (he 4)', 'cumulative_gpa_4', 'float', 4),
    ('diem tb tich luy (he 10)', 'cumulative_gpa_10', 'float', 10),
    ('xep loai hoc tap tich luy', 'cumulative_rank', 'rank', None),
]
SUMMARY_LABELS = [(re.compile(r'\s*'.join(map(re.escape, label.split())) + r'$'), field, kind, upper)
                  for label, field, kind, upper in SUMMARY_FIELDS]


def clean(value):
    return ' '.join(unicodedata.normalize('NFC', value or '').split())


def folded(value):
    return ''.join(c for c in unicodedata.normalize('NFD', clean(value))
                   if not unicodedata.combining(c)).lower().replace('đ', 'd')


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


class TableParser(HTMLParser):
    """Preserve blank cells and expand colspan; flag unsupported row spans."""
    def __init__(self):
        super().__init__()
        self.rows, self.warnings = [], []
        self.row = self.cell = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'tr':
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []
            self.span = max(1, min(100, int(attrs.get('colspan', 1))))
            if int(attrs.get('rowspan', 1)) > 1:
                self.warnings.append('unsupported_rowspan')
        elif tag == 'br' and self.cell is not None:
            self.cell.append('\n')

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.extend([''.join(self.cell).replace('\\n', '\n')] + [''] * (self.span - 1))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def native_rows(page):
    text = page.get_text()
    if not text.strip():
        return [], False, Counter()
    rows = []
    for table in sorted(page.find_tables().tables, key=lambda t: t.bbox[1]):
        rows.extend(table.extract())
    expected = Counter(CODE.findall(text))
    actual = Counter(clean(r[1]) for r in rows
                     if len(r) == 8 and CODE.fullmatch(clean(r[1])))
    usable = bool(expected) and expected == actual and '\ufffd' not in text
    return rows, usable, expected


def is_scanned(page):
    """True when a raster image covers most of the page (scan or photo); digital exports are never skewed."""
    area = abs(page.rect)
    return any(abs(pymupdf.Rect(info['bbox']) & page.rect) > .5 * area for info in page.get_image_info())


def attach_result_marks(page, rows, dpi=100):
    """Fill empty result cells of native rows from the coloured tick/cross images on the page.

    Rows from find_tables carry no coordinates, so each course row is tied to its course-code word
    (both in top-to-bottom order; native_rows already checked the counts match) and then to the
    ruled table band containing that word.
    """
    if not page.get_image_info():
        return rows
    import numpy as np
    from ppocr_table import table_bands
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    image = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
    bands = [b for b in table_bands(image)[0] if b['mark']]
    words = sorted((w for w in page.get_text('words') if CODE.fullmatch(w[4])), key=lambda w: (w[1], w[0]))
    coded = [r for r in rows if len(r) == 8 and CODE.fullmatch(clean(r[1]))]
    for row, word in zip(coded, words):
        y = (word[1] + word[3]) / 2 * dpi / 72
        band = next((b for b in bands if b['top'] < y < b['bottom']), None)
        if band and not clean(row[7]):
            row[7] = band['mark']
    return rows


def course_result(raw, letter, issues):
    """Map the result cell to 'passed' / 'failed' / None and check it against the letter grade."""
    value = clean(raw)
    if not value:
        return None, None
    if value in RESULT_MARKS:
        result, source = RESULT_MARKS[value], 'icon'
    elif folded(value) in RESULT_WORDS:
        result, source = RESULT_WORDS[folded(value)], 'text'
    else:
        issues.append('unrecognized_result')
        return None, None
    expected = 'passed' if letter in PASS_LETTERS else 'failed' if letter == 'F' else None
    if expected and result != expected:
        issues.append('result_conflicts_with_grade')
    return result, source


def summary_value(value, kind, upper, issues, field):
    value = clean(value)
    if not value:
        return None
    if kind == 'rank':
        key = folded(value)
        match = key if key in RANKS else next(iter(get_close_matches(key, RANKS, n=1, cutoff=0.6)), None)
        if match is None:
            issues.append(f'invalid_{field}')
            return None
        if match != key:
            issues.append(f'corrected_{field}')
        return match
    return number(value, field, issues, upper=upper, integer=kind == 'int')


def parse_semesters(summaries, courses):
    """Turn semester summary cells into one record per semester and check them against the courses."""
    semesters = {}
    for summary in summaries:
        key = (summary['academic_year'], summary['semester'])
        record = semesters.setdefault(key, {'academic_year': key[0], 'semester': key[1],
                                            'source_page': summary['source_page'], 'issues': []})
        for line in '\n'.join(c or '' for c in summary['raw_cells']).split('\n'):
            line = clean(line).lstrip('- ').strip()
            if not line:
                continue
            label, _, value = line.partition(':')
            spec = next((s for s in SUMMARY_LABELS if s[0].match(folded(label))), None)
            if spec is None:
                record['issues'].append('unrecognized_summary_line')
                continue
            _, field, kind, upper = spec
            parsed = summary_value(value, kind, upper, record['issues'], field)
            if kind == 'rank' and parsed:
                record[field], record[f'{field}_code'] = RANKS[parsed]
            else:
                record[field] = parsed
    for record in semesters.values():
        graded = [c for c in courses if (c['academic_year'], c['semester']) ==
                  (record['academic_year'], record['semester']) and c['score_4'] is not None
                  and c['credits'] and not c['course_code'].startswith(CONDITIONAL_PREFIXES)]
        issues = record['issues']
        if record['academic_year'] is None:
            issues.append('missing_semester_context')
        computed = {}
        if graded:
            credits = sum(c['credits'] for c in graded)
            computed['semester_gpa_4'] = round(sum(c['credits'] * c['score_4'] for c in graded) / credits + 1e-9, 2)
            computed['semester_credits_passed'] = sum(c['credits'] for c in graded
                                                      if c['letter_grade'] in PASS_LETTERS)
            for field, value in computed.items():
                if record.get(field) is not None and record[field] != value:
                    issues.append(f'{field}_mismatch')
        record['computed_from_courses'] = computed
        record['issues'] = sorted(set(issues))
        record['needs_review'] = bool(record['issues'])
    return list(semesters.values())


def create_ocr_pipeline(device):
    os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', 'True')
    from paddleocr import PaddleOCRVL
    return PaddleOCRVL(pipeline_version='v1.6', device=device,
                       use_doc_orientation_classify=False, use_doc_unwarping=False,
                       use_chart_recognition=False, use_layout_detection=True)


def table_crops(image_path, output_dir, rows_per_crop=2):
    """Split ruled VLU tables at full-width borders, never through text.

    Only trust one broad aligned table with at least five horizontal borders.
    Otherwise retain the whole page and let the layout model handle it.
    """
    import cv2
    import numpy as np
    image = cv2.imdecode(np.fromfile(str(image_path), dtype=np.uint8), cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    mask = cv2.threshold(gray, 170, 255, cv2.THRESH_BINARY_INV)[1]
    width = image.shape[1]
    lines = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
                           cv2.getStructuringElement(cv2.MORPH_RECT, (width // 2, 1)))
    contours, _ = cv2.findContours(lines, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    borders = sorted((y + h // 2, x, x + w) for x, y, w, h in
                     (cv2.boundingRect(c) for c in contours) if w > width * .65)
    if len(borders) < 5 or rows_per_crop == 0:
        return [(image_path, False, None)]
    left = int(np.median([b[1] for b in borders]))
    right = int(np.median([b[2] for b in borders]))
    if any(abs(b[1] - left) > width * .02 or abs(b[2] - right) > width * .02 for b in borders):
        return [(image_path, False, None)]
    crops = []
    for start in range(0, len(borders) - 1, rows_per_crop):
        end = min(start + rows_per_crop, len(borders) - 1)
        box = [max(0, left - 6), max(0, borders[start][0] - 3),
               min(width, right + 6), min(image.shape[0], borders[end][0] + 4)]
        x0, y0, x1, y1 = box
        path = output_dir / f'crop_{len(crops) + 1:02d}.png'
        cv2.imencode('.png', image[y0:y1, x0:x1])[1].tofile(str(path))
        crops.append((path, True, box))
    return crops


def ocr_rows(pipeline, image_path, output_dir, max_tokens, max_pixels=200704,
             table_only=False):
    rows, warnings = [], []
    for index, result in enumerate(pipeline.predict(
            str(image_path), use_queues=False, max_new_tokens=max_tokens,
            max_pixels=max_pixels, use_layout_detection=not table_only,
            prompt_label='table' if table_only else None)):
        raw_path = output_dir / f'result_{index}.json'
        result.save_to_json(save_path=str(raw_path))
        result.save_to_markdown(save_path=str(output_dir))
        raw = json.loads(raw_path.read_text(encoding='utf-8'))
        raw = raw.get('res', raw)
        for block in raw.get('parsing_res_list', []):
            content = block.get('block_content', '')
            if block.get('block_label') == 'table':
                parser = TableParser()
                parser.feed(content)
                rows.extend(parser.rows)
                warnings.extend(parser.warnings)
                if not content.rstrip().endswith('</table>'):
                    warnings.append('possibly_truncated_table')
            elif block.get('block_label') not in ('header', 'footer', 'number'):
                rows.append([content])
    return rows, warnings


def number(value, field, issues, upper=None, integer=False):
    value = clean(value)
    if not value:
        return None
    if not re.fullmatch(r'\d+(?:[.,]\d+)?', value):
        issues.append(f'invalid_{field}')
        return None
    parsed = float(value.replace(',', '.'))
    if (upper is not None and parsed > upper) or (integer and not parsed.is_integer()):
        issues.append(f'invalid_{field}')
        return None
    return int(parsed) if integer else parsed


def parse_pages(pages, catalog):
    courses, summaries, unparsed = [], [], []
    year = semester = None
    section = 'unknown'
    # Only expect a result per course when the document shows result marks at all (older exports do not).
    has_result_marks = any(len(r) == 8 and clean(r[7]) in RESULT_MARKS for p in pages for r in p['rows'])
    for page in pages:
        for row_index, raw_cells in enumerate(page['rows'], 1):
            cells = [clean(c) for c in raw_cells]
            text = ' '.join(cells)
            context = re.search(r'(\d{4}\s*-\s*\d{4}).*?HK\s*(\d+)', text, re.I)
            is_summary = any(c.startswith('-') for c in cells)
            is_transfer = 'diem bao luu' in folded(text)
            if is_summary:
                summaries.append({'academic_year': year, 'semester': semester,
                                  'source_page': page['page'], 'raw_cells': raw_cells})
            if context:
                year = context[1].replace(' ', '')
                semester = f'HK{int(context[2]):02d}'
                section = 'semester'
            elif is_transfer:
                year = semester = None
                section = 'credit_transfer'
            if not cells or not cells[0].isdigit():
                if text and not context and not is_summary and not is_transfer and 'ma mon' not in folded(text):
                    unparsed.append({'source_page': page['page'], 'raw_cells': raw_cells})
                continue
            issues = []
            if len(cells) != 8:
                issues.append('unexpected_column_count')
            cells = (cells + [''] * 8)[:8]
            code, name = cells[1:3]
            if not CODE.fullmatch(code):
                issues.append('invalid_course_code')
            if not name:
                issues.append('missing_course_name')
            if any(t in name for t in ('\\text', '$', '<')) or any(
                    ch.isalpha() and 'LATIN' not in unicodedata.name(ch, '') for ch in name):
                issues.append('suspicious_course_name')
            if section == 'unknown':
                issues.append('missing_semester_context')
            credits = number(cells[3], 'credits', issues, integer=True)
            if credits is None:
                issues.append('missing_credits')
            score10 = number(cells[4], 'score_10', issues, upper=10)
            score4 = number(cells[5], 'score_4', issues, upper=4)
            letter = cells[6] or None
            if letter is None and (score10 is not None or score4 is not None):
                issues.append('missing_letter_grade')
            if (score10 is None) != (score4 is None):
                issues.append('incomplete_scores')
            if letter and letter not in {'A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F', 'MT'}:
                issues.append('unrecognized_letter_grade')
            result, result_source = course_result(cells[7], letter, issues)
            if result is None and has_result_marks and (letter in PASS_LETTERS or letter == 'F'):
                issues.append('missing_result')
            suggestions = []
            matched = code in catalog
            if catalog and not matched:
                issues.append('course_not_in_catalog')
                suggestions = get_close_matches(code, catalog, n=3, cutoff=0.7)
            courses.append({
                'id': f"p{page['page']}-r{row_index}", 'ordinal': int(cells[0]),
                'academic_year': year, 'semester': semester, 'section': section,
                'course_code': code, 'course_name': catalog[code] if matched else name,
                'course_name_raw': name, 'credits': credits,
                'score_10': score10, 'score_4': score4, 'letter_grade': letter,
                'result': result, 'result_source': result_source, 'result_raw': cells[7] or None,
                'source_page': page['page'], 'extraction_method': page['method'],
                'catalog_matched': matched, 'suggested_course_codes': suggestions,
                'needs_review': bool(issues) or bool(page['warnings']),
                'issues': issues, 'raw_cells': raw_cells})
    return courses, summaries, unparsed


class OcrRequired(RuntimeError):
    """A page has no usable text layer and OCR is disabled."""


@dataclass
class Options:
    mode: str = 'auto'  # auto | native | ocr
    engine: str = 'ppocr'  # ppocr | vl
    ocr_enabled: bool = True
    device: str = 'gpu:0'
    dpi: int | None = None  # default: DEFAULT_DPI[engine]
    rec_model_dir: Path = DEFAULT_REC_MODEL
    det_model: str = DEFAULT_DET_MODEL
    max_new_tokens: int = 2048  # vl only
    max_pixels: int = 200704  # vl only
    rows_per_crop: int = 2  # vl only


def _ppocr_page(page, is_pdf, options, models, page_dir, log):
    import numpy as np
    from ppocr_table import create_engine, page_rows, rectify
    if 'ppocr' not in models:
        if not (Path(options.rec_model_dir) / 'inference.pdiparams').exists():
            raise FileNotFoundError(f'Recogniser not found: {options.rec_model_dir}. Train/export it with '
                                    'training/run_experiment.py F3_frozen_lr1e-3 or pass --rec-model-dir.')
        models['ppocr'] = create_engine(options.rec_model_dir, options.device, det_model=options.det_model)
    pix = page.get_pixmap(dpi=options.dpi or DEFAULT_DPI['ppocr'], alpha=False)
    if page_dir:
        pix.save(str(page_dir / 'input.png'))
    image = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
    warnings = []
    if not is_pdf or is_scanned(page):
        image, skew = rectify(image)
        if skew:
            warnings.append(f'rectified_skew_degrees:{skew}')
    log(f'Page {page.number + 1}: PP-OCRv5 lines')
    rows, page_warnings, lines = page_rows(image, *models['ppocr'])
    if page_dir:
        save_json(page_dir / 'ppocr_lines.json', lines)
    return rows, warnings + page_warnings


def _vl_page(page, options, models, page_dir, log):
    if 'vl' not in models:
        models['vl'] = create_ocr_pipeline(options.device)
    image_path = page_dir / 'input.png'
    page.get_pixmap(dpi=options.dpi or DEFAULT_DPI['vl'], alpha=False).save(str(image_path))
    rows, warnings = [], []
    crops = table_crops(image_path, page_dir, options.rows_per_crop)
    save_json(page_dir / 'crops.json', [{'image': p.name, 'table_only': t, 'bbox_pixels': box} for p, t, box in crops])
    for crop_index, (crop, table_only, _) in enumerate(crops, 1):
        crop_dir = page_dir / f'part_{crop_index:02d}'
        crop_dir.mkdir(parents=True, exist_ok=True)
        log(f'Page {page.number + 1}, crop {crop_index}/{len(crops)}: OCR')
        crop_rows, crop_warnings = ocr_rows(models['vl'], crop, crop_dir, options.max_new_tokens,
                                            options.max_pixels, table_only)
        rows.extend(crop_rows)
        warnings.extend(crop_warnings)
    return rows, warnings


def extract_transcript(document, source_name, options=None, catalog=None, output_dir=None, models=None,
                       log=lambda message: print(message, flush=True)):
    """Read an open PyMuPDF document into the transcript dict: text layer first, OCR for the other pages.

    output_dir (optional) receives page images and intermediate JSON; the VL engine requires it.
    models caches loaded OCR engines between calls (pass the same dict to reuse them).
    Raises OcrRequired when a page needs OCR and options.ocr_enabled is False.
    """
    options = options or Options()
    catalog = catalog or {}
    models = {} if models is None else models
    if options.engine == 'vl' and output_dir is None:
        raise ValueError('The vl engine writes page crops and needs output_dir')
    pages = []
    for index, page in enumerate(document, 1):
        page_dir = None
        if output_dir is not None:
            page_dir = Path(output_dir) / f'page_{index}'
            page_dir.mkdir(parents=True, exist_ok=True)
        rows, usable, expected = native_rows(page) if document.is_pdf else ([], False, Counter())
        needs_ocr = options.mode == 'ocr' or not usable
        if options.mode == 'native' and not usable:
            raise RuntimeError(f'Page {index}: native extraction incomplete; use --mode auto')
        if needs_ocr and not options.ocr_enabled:
            raise OcrRequired(f'Page {index} has no usable text layer and OCR is disabled')
        if needs_ocr:
            if options.engine == 'ppocr':
                method = 'ppocr'
                rows, warnings = _ppocr_page(page, document.is_pdf, options, models, page_dir, log)
            else:
                method = 'ocr'
                rows, warnings = _vl_page(page, options, models, page_dir, log)
            warnings.append('ocr_requires_visual_review')
            actual = Counter(clean(r[1]) for r in rows if len(r) >= 2 and clean(r[0]).isdigit())
            if expected and actual != expected:
                warnings.append('course_codes_differ_from_pdf_text')
        else:
            method, warnings = 'pdf_text', []
            rows = attach_result_marks(page, rows)
        data = {'page': index, 'method': method, 'warnings': warnings, 'rows': rows}
        if page_dir:
            save_json(page_dir / 'extracted_rows.json', data)
        pages.append(data)
        log(f'Page {index}: {method}, {len(rows)} table rows')
    courses, summaries, unparsed = parse_pages(pages, catalog)
    semesters = parse_semesters(summaries, courses)
    ocr_used = any(p['method'] != 'pdf_text' for p in pages)
    return {
        'schema_version': '1.1', 'source_file': source_name, 'adapter': 'vlu_8_columns',
        'course_count': len(courses),
        'ocr_settings': {'engine': options.engine, 'det_model': options.det_model,
                         'rec_model_dir': str(options.rec_model_dir), 'dpi': options.dpi or DEFAULT_DPI[options.engine]}
        if ocr_used else None,
        'needs_review': not courses or bool(unparsed) or any(c['needs_review'] for c in courses)
                        or any(s['needs_review'] for s in semesters) or any(p['warnings'] for p in pages),
        'pages': [{k: v for k, v in p.items() if k != 'rows'} for p in pages],
        'courses': courses, 'semesters': semesters, 'summaries': summaries, 'unparsed_rows': unparsed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', nargs='?', type=Path, default=ROOT / 'data/bang_diem.pdf')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/structured')
    parser.add_argument('--mode', choices=('auto', 'native', 'ocr'), default='auto')
    parser.add_argument('--dpi', type=int, help='Render DPI for OCR; default 150 (ppocr) or 300 (vl)')
    parser.add_argument('--max-new-tokens', type=int, default=2048)
    parser.add_argument('--max-pixels', type=int, default=200704)
    parser.add_argument('--rows-per-crop', type=int, default=2,
                        help='Ruled-table bands per crop; 0 disables splitting')
    parser.add_argument('--device', default='gpu:0')
    parser.add_argument('--engine', choices=('vl', 'ppocr'), default='ppocr',
                        help='OCR fallback: PP-OCRv5 lines + grid (default) or PaddleOCR-VL table parsing')
    parser.add_argument('--rec-model-dir', type=Path, default=DEFAULT_REC_MODEL,
                        help='Exported recogniser for --engine ppocr (default: fine-tuned Vietnamese F3)')
    parser.add_argument('--det-model', default=DEFAULT_DET_MODEL,
                        help='Line detector for --engine ppocr (PP-OCRv5_mobile_det: ~half the CPU time and memory)')
    parser.add_argument('--catalog', type=Path)
    args = parser.parse_args()
    if args.dpi is not None and args.dpi <= 0 or args.max_new_tokens <= 0 or args.max_pixels <= 0 \
            or args.rows_per_crop < 0:
        parser.error('DPI, pixels and tokens must be positive; rows-per-crop must be >= 0')
    catalog = json.loads(args.catalog.read_text(encoding='utf-8')) if args.catalog else {}
    if not isinstance(catalog, dict) or not all(isinstance(k, str) and isinstance(v, str)
                                             for k, v in catalog.items()):
        parser.error('Catalog must be a JSON object mapping course codes to names')
    catalog = {clean(k): clean(v) for k, v in catalog.items()}
    options = Options(mode=args.mode, engine=args.engine, device=args.device, dpi=args.dpi,
                      rec_model_dir=args.rec_model_dir, det_model=args.det_model,
                      max_new_tokens=args.max_new_tokens, max_pixels=args.max_pixels,
                      rows_per_crop=args.rows_per_crop)
    args.output.mkdir(parents=True, exist_ok=True)
    try:
        with pymupdf.open(args.input) as document:
            result = extract_transcript(document, args.input.name, options, catalog, args.output)
    except (FileNotFoundError, OcrRequired) as error:
        raise SystemExit(str(error))
    result['catalog_source'] = args.catalog.name if args.catalog else None
    save_json(args.output / 'transcript.json', result)
    print(f"Saved {result['course_count']} courses to {args.output / 'transcript.json'}")
    print(f"Needs review: {result['needs_review']}")


if __name__ == '__main__':
    main()
