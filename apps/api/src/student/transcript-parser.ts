import { Worker } from "node:worker_threads";

export class TranscriptError extends Error {
  constructor(public readonly code: string, public readonly status = 422) { super(code); }
}
type Item = { text: string; x: number; y: number; width: number };
type Page = { page: number; items: Item[] };
export type TranscriptCourse = { ordinal: number; code: string; name: string; credits: number; score10: number | null; score4: number | null; letter: string | null; result: string | null; conditional: boolean; sourcePage: number };
export type TranscriptSection = { id: string; academicYear: string | null; semester: string | null; label: string; courses: TranscriptCourse[]; summaries: { label: string; value: string | null }[] };
export type TranscriptData = { schemaVersion: 1; parserVersion: "vlu-native-1" | "vlu-ocr-1.1"; pageCount: number; courseCount: number; sections: TranscriptSection[]; warnings: string[]; ocr?: { needsReview: boolean; pages: { page: number; method: string; warnings: string[] }[]; semesters: Record<string, unknown>[] } };
const clean = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const fold = (s: string) => clean(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d");
function join(items: Item[]) {
  let text = "", end = 0;
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    if (text && item.x - end > 1.2 && !text.endsWith(" ")) text += " ";
    text += item.text; end = item.x + item.width;
  }
  return clean(text);
}
function lines(items: Item[]) {
  const result: { y: number; items: Item[]; text: string }[] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = result[result.length - 1];
    if (!line || Math.abs(line.y - item.y) > 2) { line = { y: item.y, items: [], text: "" }; result.push(line); }
    line.items.push(item);
  }
  for (const line of result) line.text = join(line.items);
  return result;
}
function numeric(value: string, max: number, required = false): number | null {
  if (!value && !required) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) throw new TranscriptError("unreadable_grades");
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n) || n > max) throw new TranscriptError("unreadable_grades");
  return n;
}

// PDF extraction runs off the API thread and is terminated after 25 seconds.
let extracting = false;
export async function parseTranscript(pdf: Buffer): Promise<TranscriptData> {
  if (extracting) throw new TranscriptError("parser_busy", 429);
  extracting = true;
  try {
    const pages = await new Promise<Page[]>((resolve, reject) => {
      const worker = new Worker(`
        const {parentPort,workerData}=require('node:worker_threads');
        (async()=>{
          const {getDocument}=await import(workerData.module);
          const task=getDocument({data:new Uint8Array(workerData.pdf),isEvalSupported:false,disableFontFace:true,verbosity:0});
          try {
            const doc=await task.promise;
            if(doc.numPages>20) throw new Error('too_many_pages');
            const pages=[];
            for(let n=1;n<=doc.numPages;n++){
              const page=await doc.getPage(n), viewport=page.getViewport({scale:1});
              const content=await page.getTextContent();
              if(content.items.length>20000) throw new Error('unsupported_pdf');
              const items=content.items.filter(i=>'str' in i && i.str).map(i=>{
                const [x,y]=viewport.convertToViewportPoint(i.transform[4],i.transform[5]);
                return {text:i.str,x:x/viewport.width*612,y:y/viewport.height*792,width:i.width/viewport.width*612};
              }).filter(i=>i.y>32&&i.y<757);
              pages.push({page:n,items});
            }
            parentPort.postMessage({pages});
          } finally {await task.destroy();}
        })().catch(e=>parentPort.postMessage({error:e.name==='PasswordException'?'encrypted_pdf':e.message==='too_many_pages'?'too_many_pages':'unsupported_pdf'}));
      `, { eval: true, execArgv: [], workerData: { pdf, module: import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs") }, resourceLimits: { maxOldGenerationSizeMb: 192 } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new TranscriptError("parse_timeout")); }, 25000);
      worker.once("message", (message: { pages?: Page[]; error?: string }) => { clearTimeout(timer); void worker.terminate(); if (message.pages) resolve(message.pages); else reject(new TranscriptError(message.error ?? "unsupported_pdf")); });
      worker.once("error", () => { clearTimeout(timer); reject(new TranscriptError("unsupported_pdf")); });
      worker.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new TranscriptError("unsupported_pdf")); });
    });
    return parsePages(pages);
  } finally { extracting = false; }
}

export function parsePages(pages: Page[]): TranscriptData {
  const sections: TranscriptSection[] = [];
  let active: TranscriptSection | undefined;
  let count = 0;
  const codePattern = /^\d{2}[A-Z]{2,10}\d{5,8}$/;
  if (pages.some(page => !page.items.some(item => clean(item.text)))) throw new TranscriptError("scanned_pdf");
  const firstText = fold(lines(pages[0]?.items ?? []).map(l => l.text).join(" "));
  if (!["ma mon hoc", "ten mon hoc", "tin chi", "he 10", "he 4"].every(t => firstText.includes(t))) throw new TranscriptError("unsupported_layout");
  for (const page of pages) {
    const pageLines = lines(page.items);
    if (!pageLines.length) throw new TranscriptError("scanned_pdf");
    const anchors = pageLines.filter(l => l.items.some(i => codePattern.test(clean(i.text)) && i.x > 60 && i.x < 155));
    // Refuse unrecognized numbered rows instead of silently dropping courses.
    const numbered = pageLines.filter(l => /^\d+$/.test(join(l.items.filter(i => i.x >= 28 && i.x < 61))));
    if (numbered.length !== anchors.length) throw new TranscriptError("unreadable_rows");
    const events = pageLines.filter(l => /\d{4}\s*-\s*\d{4}.*HK\s*\d+/i.test(l.text) || fold(l.text).includes("diem bao luu") || l.text.startsWith("-") || anchors.includes(l));
    for (let index = 0; index < events.length; index++) {
      const line = events[index]!;
      const context = line.text.match(/(\d{4})\s*-\s*(\d{4}).*HK\s*(\d+)/i);
      if (context || fold(line.text).includes("diem bao luu")) {
        if (context && (Number(context[2]) !== Number(context[1]) + 1 || Number(context[3]) < 1 || Number(context[3]) > 3)) throw new TranscriptError("unsupported_layout");
        const academicYear = context ? `${context[1]}-${context[2]}` : null;
        const semester = context ? `HK${context[3]!.padStart(2, "0")}` : null;
        const id = context ? `${academicYear}-${semester}` : "transfer";
        active = sections.find(s => s.id === id);
        if (!active) { active = { id, academicYear, semester, label: context ? `${academicYear} · ${semester}` : "Điểm bảo lưu", courses: [], summaries: [] }; sections.push(active); }
        continue;
      }
      if (line.text.startsWith("-")) {
        if (active) for (const segment of [line.items.filter(i => i.x < 384), line.items.filter(i => i.x >= 384)]) {
          const raw = join(segment).replace(/^-\s*/, ""); const colon = raw.indexOf(":");
          if (raw && colon >= 0) active.summaries.push({ label: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() || null });
        }
        continue;
      }
      if (!active) throw new TranscriptError("missing_semester");
      const top = Math.max(line.y - 24, index ? (events[index - 1]!.y + line.y) / 2 : 32);
      const bottom = Math.min(line.y + 24, index + 1 < events.length ? (events[index + 1]!.y + line.y) / 2 : 757);
      const rowItems = page.items.filter(i => i.y > top && i.y < bottom);
      const bounds = [28, 61, 156, 323, 384, 424, 464, 528, 585];
      const cells = bounds.slice(0, -1).map((left, col) => lines(rowItems.filter(i => i.x >= left && i.x < bounds[col + 1]!)).map(l => l.text).join(" ").trim());
      if (!codePattern.test(cells[1]!) || !/^\d+$/.test(cells[0]!) || !cells[2] || cells.some(c => c.includes("\ufffd"))) throw new TranscriptError("unreadable_rows");
      const credits = numeric(cells[3]!, 30, true)!;
      if (!Number.isInteger(credits)) throw new TranscriptError("unreadable_grades");
      const score10 = numeric(cells[4]!, 10), score4 = numeric(cells[5]!, 4), letter = cells[6] || null;
      if (letter && !/^(A\+?|B\+?|C\+?|D\+?|F|MT)$/.test(letter)) throw new TranscriptError("unreadable_grades");
      if ((score10 === null) !== (score4 === null)) throw new TranscriptError("unreadable_grades");
      if (active.courses.some(c => c.ordinal === Number(cells[0]))) throw new TranscriptError("duplicate_rows");
      active.courses.push({ ordinal: Number(cells[0]), code: cells[1]!, name: cells[2]!, credits, score10, score4, letter, result: cells[7] || null, conditional: cells[2]!.includes("*"), sourcePage: page.page });
      count++;
    }
  }
  if (!count || count > 1000 || sections.some(s => !s.courses.length)) throw new TranscriptError("unreadable_rows");
  return { schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: pages.length, courseCount: count, sections, warnings: ["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh.", "Cột kết quả trống hoặc biểu tượng không có lớp chữ được giữ trống; không suy đoán từ điểm."] };
}
