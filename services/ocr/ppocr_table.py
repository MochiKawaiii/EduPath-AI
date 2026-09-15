"""Transcript table rows from PP-OCRv5 line detection and a line recogniser.

Alternative to the PaddleOCR-VL path in test_ocr.py. Ruling lines give the
cell grid, the detector gives text-line boxes, and each line is placed in the
cell that contains its centre, so no text is guessed from layout.

The pass/fail column holds small coloured images (green tick, red cross), not
text, so it is read by colour instead of OCR (see result_mark).
"""
import os

import numpy as np

from test_ocr import clean

TICK, CROSS, UNKNOWN_MARK = '✓', '✗', '?'
MIN_MARK_PIXELS = 12  # a 12 pt icon has ~40 coloured pixels even at 72 DPI


def create_engine(rec_model_dir=None, device='gpu:0', det_model='PP-OCRv5_server_det'):
    os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', 'True')
    from paddleocr import TextDetection, TextRecognition
    det = TextDetection(model_name=det_model, device=device, limit_side_len=2400, limit_type='max')
    rec_kwargs = {'model_name': 'latin_PP-OCRv5_mobile_rec', 'device': device}
    if rec_model_dir:
        rec_kwargs['model_dir'] = str(rec_model_dir)
    return det, TextRecognition(**rec_kwargs)


def _merge(values, gap, touching=False):
    """Merge (position, start, end) segments at the same position.

    With touching=True the extents must also meet, so short rulings in
    different rows are not joined into one line across the whole page.
    """
    merged = []
    for value in sorted(values, key=lambda v: (v[0], v[1])):
        match = next((i for i in range(len(merged) - 1, -1, -1)
                      if value[0] - merged[i][0] <= gap
                      and (not touching or value[1] <= merged[i][2] + gap)), None)
        if match is None:
            merged.append(value)
        else:
            old = merged[match]
            merged[match] = (old[0], min(old[1], value[1]), max(old[2], value[2]))
    return merged


def flatten_background(gray):
    """Divide out uneven lighting (shadows, vignetting): paper becomes ~255 and ink stays dark."""
    import cv2
    background = cv2.medianBlur(cv2.dilate(gray, np.ones((9, 9), np.uint8)), 31)
    return cv2.divide(gray, background, scale=255)


def _grid_at(gray, threshold):
    import cv2
    mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY_INV)[1]
    height, width = gray.shape

    def segments(kernel):
        lines = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, kernel))
        return [cv2.boundingRect(c) for c in cv2.findContours(lines, cv2.RETR_EXTERNAL,
                                                               cv2.CHAIN_APPROX_SIMPLE)[0]]

    borders = _merge([(y + h // 2, x, x + w) for x, y, w, h in segments((width // 2, 1))
                      if w > width * .65], gap=4)
    # Kernel longer than glyph stems (~1/100 page height) but shorter than a table row.
    verticals = _merge([(x + w // 2, y, y + h) for x, y, w, h in segments((1, max(15, height // 60)))],
                       gap=4, touching=True)
    return borders, verticals


def _course_bands(borders, verticals):
    if len(borders) < 2:
        return 0
    left = int(np.median([b[1] for b in borders]))
    right = int(np.median([b[2] for b in borders]))
    return sum(len(_cells(t, b, verticals, left, right)) == 8 for (t, *_), (b, *_) in zip(borders, borders[1:]))


def table_grid(image):
    """Horizontal borders spanning the table and vertical rulings with their extents.

    Lighting is flattened first. A threshold of 170 keeps text strokes out of the rulings; blurred
    rulings turn light grey and need 215. Both are tried and the grid with more 8-cell course rows wins
    (ties keep 170, which splits fewer summary rows).
    """
    import cv2
    gray = flatten_background(cv2.cvtColor(image, cv2.COLOR_RGB2GRAY))
    grids = [_grid_at(gray, threshold) for threshold in (170, 215)]
    return max(grids, key=lambda grid: _course_bands(*grid))


def rectify(image, min_skew=0.1):
    """Straighten a rotated or perspective-distorted page using the table rulings.

    Long ruling segments are found with a probabilistic Hough transform; the outermost horizontal and
    vertical lines give a quadrilateral that is warped to a rectangle. Returns (image, skew_degrees);
    the image is returned unchanged when the rulings are already straight or no table is found.
    """
    import cv2
    full_height, full_width = image.shape[:2]
    scale = min(1.0, 900 / full_width)  # lines are found on a small copy; the warp uses the full image
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    gray = flatten_background(cv2.cvtColor(small, cv2.COLOR_RGB2GRAY))
    mask = cv2.dilate(cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)[1], np.ones((2, 2), np.uint8))
    height, width = gray.shape

    def fitted_lines(kernel, horizontal):
        lines = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, kernel))
        length = int((width * .4) if horizontal else (height * .25))
        found = cv2.HoughLinesP(lines, 1, np.pi / 720, threshold=length // 2, minLineLength=length, maxLineGap=12)
        groups = []  # (position at page centre, slope, weight): y = slope * x + b or x = slope * y + b
        for x0, y0, x1, y1 in ([] if found is None else found[:, 0]):
            if horizontal and x1 != x0 and abs(y1 - y0) < abs(x1 - x0) * .18:
                slope = (y1 - y0) / (x1 - x0)
                centre = y0 + slope * (width / 2 - x0)
            elif not horizontal and y1 != y0 and abs(x1 - x0) < abs(y1 - y0) * .18:
                slope = (x1 - x0) / (y1 - y0)
                centre = x0 + slope * (height / 2 - y0)
            else:
                continue
            weight = float(np.hypot(x1 - x0, y1 - y0))
            group = next((g for g in groups if abs(g[0] - centre) < 6), None)
            if group is None:
                groups.append([centre, slope, weight])
            else:
                total = group[2] + weight
                group[0], group[1] = (group[0] * group[2] + centre * weight) / total, \
                                     (group[1] * group[2] + slope * weight) / total
                group[2] = total
        return sorted(groups)

    rows = fitted_lines((max(15, width // 60), 1), True)
    columns = fitted_lines((1, max(15, height // 60)), False)
    if len(rows) < 2 or len(columns) < 2:
        return image, 0.0
    skew = float(np.degrees(np.arctan(np.median([r[1] for r in rows]))))

    def corner(row, column):
        # y = a(x - w/2) + p  and  x = c(y - h/2) + q
        (p, a, _), (q, c, _) = row, column
        y = (a * (q - c * height / 2 - width / 2) + p) / (1 - a * c)
        return c * (y - height / 2) + q, y

    top, bottom, left, right = rows[0], rows[-1], columns[0], columns[-1]
    source = np.float32([corner(top, left), corner(top, right), corner(bottom, right), corner(bottom, left)]) / scale
    x0, x1 = (source[0, 0] + source[3, 0]) / 2, (source[1, 0] + source[2, 0]) / 2
    y0, y1 = (source[0, 1] + source[1, 1]) / 2, (source[2, 1] + source[3, 1]) / 2
    target = np.float32([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
    if abs(skew) < min_skew and np.abs(source - target).max() < 2:
        return image, 0.0
    matrix = cv2.getPerspectiveTransform(source, target)
    warped = cv2.warpPerspective(image, matrix, (full_width, full_height), flags=cv2.INTER_CUBIC,
                                 borderValue=(255, 255, 255))
    return warped, round(skew, 2)


def _cells(top, bottom, verticals, left, right):
    xs = sorted({left, right} | {x for x, y0, y1 in verticals
                                 if left - 6 <= x <= right + 6 and y0 <= top + 6 and y1 >= bottom - 6})
    xs = [x for i, x in enumerate(xs) if i == 0 or x - xs[i - 1] > 8]
    return list(zip(xs, xs[1:]))


def result_mark(patch):
    """TICK for a green icon, CROSS for a red one, UNKNOWN_MARK for other ink, '' for an empty RGB patch.

    Colourless ink (e.g. a greyscale scan) cannot be told apart reliably, so it is reported as unknown.
    """
    import cv2
    if patch.size == 0:
        return ''
    patch = cv2.medianBlur(np.ascontiguousarray(patch), 3)  # colour noise must not add up to an icon
    hue, sat, val = cv2.split(cv2.cvtColor(patch, cv2.COLOR_RGB2HSV))
    vivid = (sat > 70) & (val > 70)
    green = int(np.count_nonzero(vivid & (hue >= 35) & (hue <= 90)))
    red = int(np.count_nonzero(vivid & ((hue <= 10) | (hue >= 170))))
    if green >= max(MIN_MARK_PIXELS, 3 * red):
        return TICK
    if red >= max(MIN_MARK_PIXELS, 3 * green):
        return CROSS
    ink = int(np.count_nonzero(cv2.cvtColor(patch, cv2.COLOR_RGB2GRAY) < 128))
    return UNKNOWN_MARK if ink >= MIN_MARK_PIXELS else ''


def table_bands(image):
    """Rows of the ruled table: dicts with top, bottom, cells [(x0, x1)] and the result-column mark.

    Returns (bands, warnings); bands is empty when no table grid is found.
    """
    borders, verticals = table_grid(image)
    if len(borders) < 2:
        return [], ['table_grid_not_found']
    left = int(np.median([b[1] for b in borders]))
    right = int(np.median([b[2] for b in borders]))
    bands = []
    for (top, *_), (bottom, *_) in zip(borders, borders[1:]):
        cells = _cells(top, bottom, verticals, left, right)
        mark = ''
        if len(cells) == 8:  # course row; skip header, semester title and summary rows
            x0, x1 = cells[-1]
            mark = result_mark(image[top + 4:bottom - 3, x0 + 4:x1 - 3])
        bands.append({'top': top, 'bottom': bottom, 'cells': cells, 'mark': mark})
    return bands, []


def detect_boxes(image, det, **det_params):
    """Axis-aligned text-line boxes (x0, y0, x1, y1) for an RGB page."""
    polys = next(iter(det.predict(image[:, :, ::-1].copy(), **det_params)))['dt_polys']
    h, w = image.shape[:2]
    boxes = [(max(0, int(p[:, 0].min())), max(0, int(p[:, 1].min())),
              min(w, int(np.ceil(p[:, 0].max()))), min(h, int(np.ceil(p[:, 1].max())))) for p in polys]
    return [b for b in boxes if b[2] > b[0] and b[3] > b[1]]


def recognize(image, boxes, rec, pad=0, batch_size=16):
    """Read each box; pad adds context pixels around the detector box."""
    h, w = image.shape[:2]
    crops = [np.ascontiguousarray(image[max(0, y0 - pad):min(h, y1 + pad),
                                        max(0, x0 - pad):min(w, x1 + pad), ::-1])
             for x0, y0, x1, y1 in boxes]
    readings = list(rec.predict(crops, batch_size=batch_size)) if crops else []
    return [{'box': list(b), 'text': clean(r['rec_text']), 'score': round(float(r['rec_score']), 4)}
            for b, r in zip(boxes, readings)]


def page_rows(image, det, rec, batch_size=16, pad=0, **det_params):
    """Return (rows, warnings, lines) for one RGB page image."""
    lines = recognize(image, detect_boxes(image, det, **det_params), rec, pad, batch_size)
    return rows_from_lines(image, lines)


def rows_from_lines(image, lines):
    """Place recognised lines into table cells; returns (rows, warnings, lines).

    The result cell of a course row takes the colour mark: a detected TICK / CROSS replaces the
    recogniser's text (it reads the icons as '/', 'I' or '='); UNKNOWN_MARK only fills an empty cell,
    so a written result such as 'Đạt' is kept. The raw text stays in lines.
    """
    bands, warnings = table_bands(image)
    if not bands:
        rows = [[line['text']] for line in sorted(lines, key=lambda l: (l['box'][1], l['box'][0]))]
        return rows, warnings, lines
    for band in bands:
        band['texts'] = [[] for _ in band['cells']]
    for line in lines:
        x0, y0, x1, y1 = line['box']
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        band = next((b for b in bands if b['top'] < cy < b['bottom']), None)
        if band is None:
            line['cell'] = 'outside_table'
            continue
        index = next((i for i, (a, b) in enumerate(band['cells']) if a < cx < b), None)
        if index is None:
            line['cell'] = 'outside_cells'
            warnings.append('line_outside_cells')
            continue
        band['texts'][index].append((y0, x0, line['text']))
        line['cell'] = [bands.index(band), index]
    rows = []
    for band in bands:
        if any(band['texts']):
            row = ['\n'.join(t for _, _, t in sorted(cell)) for cell in band['texts']]
            if band['mark'] in (TICK, CROSS) or (band['mark'] and not row[-1]):
                row[-1] = band['mark']
            rows.append(row)
    def replaced_by_mark(cell):
        band = bands[cell[0]]
        return band['mark'] in (TICK, CROSS) and cell[1] == len(band['cells']) - 1

    low = [l for l in lines if l['score'] < .8 and isinstance(l.get('cell'), list) and not replaced_by_mark(l['cell'])]
    if low:
        warnings.append(f'low_confidence_lines:{len(low)}')
    return rows, sorted(set(warnings)), lines
