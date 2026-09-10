import { useCallback, useEffect, useRef, useState } from "react";
import "./student-records.css";

type Course = { ordinal: number; code: string; name: string; credits: number; score10: number | null; score4: number | null; letter: string | null; result: string | null; conditional: boolean; sourcePage: number };
type Section = { id: string; label: string; academicYear: string | null; semester: string | null; courses: Course[]; summaries: { label: string; value: string | null }[] };
type Transcript = { version: string; filename: string; fileSize: number; createdAt: string; updatedAt: string; data: { schemaVersion: number; parserVersion: string; pageCount: number; courseCount: number; sections: Section[]; warnings: string[] } };
const errors: Record<string, string> = {
  invalid_pdf: "Chỉ nhận file PDF hợp lệ.", pdf_too_large: "File vượt quá giới hạn 5 MB.",
  unsupported_pdf: "Không đọc được PDF này. Hãy xuất lại PDF từ cổng đào tạo của trường.",
  unsupported_layout: "PDF không khớp bảng điểm 8 cột của trường hoặc không có lớp chữ. Hãy dùng bản PDF xuất từ cổng đào tạo.",
  scanned_pdf: "PDF có trang ảnh/scan không đọc được chữ. Phiên bản này hỗ trợ PDF có lớp chữ; OCR sẽ được bổ sung sau.",
  unreadable_rows: "Có dòng môn học chưa đọc đầy đủ. Bảng điểm cũ vẫn được giữ nguyên; hãy xuất lại file PDF.",
  unreadable_grades: "Có ô tín chỉ hoặc điểm không đọc được chính xác. Bảng điểm cũ vẫn được giữ nguyên.",
  missing_semester: "Không xác định được học kỳ của một số môn học.", duplicate_rows: "Phát hiện dòng học phần trùng trong cùng học kỳ. Hãy kiểm tra lại PDF.",
  encrypted_pdf: "PDF có mật khẩu. Hãy tải lên bản PDF không khóa.", too_many_pages: "Chỉ hỗ trợ bảng điểm tối đa 20 trang.",
  parse_timeout: "Đọc PDF quá thời gian cho phép. Hãy thử file PDF xuất trực tiếp từ cổng đào tạo.",
  parser_busy: "Máy chủ đang đọc một bảng điểm khác. Vui lòng thử lại sau vài giây.",
  transcript_changed: "Bảng điểm đã thay đổi ở phiên khác. Bấm tải lại trước khi tiếp tục.",
  authentication_required: "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.",
  database_required: "Chưa kết nối được nơi lưu bảng điểm. Vui lòng thử lại sau.",
  ownership_confirmation_required: "Hãy xác nhận đây là bảng điểm của bạn.",
  insufficient_role: "Tài khoản hiện không có quyền sinh viên.", invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang."
};
async function read(response: Response): Promise<{ transcript: Transcript | null }> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errors[data.error] ?? "Thao tác chưa thành công. Vui lòng thử lại.");
  return data;
}
export default function StudentTranscript() {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort(); const pending = new AbortController(); controller.current = pending;
    setLoading(true); setError(""); setLoaded(false);
    try { const data = await read(await fetch("/api/student/transcript", { credentials: "include", signal: pending.signal })); if (!pending.signal.aborted) { setTranscript(data.transcript); setLoaded(true); } }
    catch (e) { if (!pending.signal.aborted) setError(e instanceof Error ? e.message : "Không tải được bảng điểm."); }
    finally { if (!pending.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  const clearFile = () => { setFile(null); setConfirmed(false); if (input.current) input.current.value = ""; };
  const upload = async () => {
    if (!file || !confirmed || !loaded) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(file.name), "X-Confirm-Own-Transcript": "true" };
      if (transcript) headers["X-Transcript-Version"] = transcript.version;
      const data = await read(await fetch("/api/student/transcript", { method: "POST", credentials: "include", headers, body: file }));
      setTranscript(data.transcript); clearFile(); setFilter("all"); setSearch(""); setMessage("Đã lưu bảng điểm. Bạn có thể đối chiếu các học phần bên dưới với PDF gốc.");
    } catch (e) { setError(e instanceof Error ? e.message : "Không import được bảng điểm."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!transcript || !window.confirm("Xóa PDF và toàn bộ dữ liệu bảng điểm đã import? Thông tin cá nhân của bạn vẫn được giữ lại.")) return;
    setBusy(true); setError(""); setMessage("");
    try { await read(await fetch("/api/student/transcript", { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: transcript.version, confirmed: true }) })); setTranscript(null); clearFile(); setFilter("all"); setMessage("Đã xóa PDF và dữ liệu bảng điểm."); }
    catch (e) { setError(e instanceof Error ? e.message : "Không xóa được bảng điểm."); }
    finally { setBusy(false); }
  };
  const exportJson = () => {
    if (!transcript) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(transcript.data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "bang-diem.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const sections = transcript?.data.sections.filter(s => filter === "all" || s.id === filter) ?? [];
  const matches = (c: Course) => `${c.code} ${c.name}`.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"));
  const count = sections.reduce((n, s) => n + s.courses.filter(matches).length, 0);
  return <section className="sw-panel sr-transcript" aria-labelledby="transcript-title"><div className="sw-section-heading"><div><h2 id="transcript-title">Bảng điểm của tôi</h2><p className="sw-muted">Import PDF từ cổng đào tạo để theo dõi kết quả học tập.</p></div><span className="sw-tag">PDF · tối đa 5 MB</span></div>
    {loading && <p role="status">Đang tải bảng điểm…</p>}{error && <div className="sr-error" role="alert">{error}<button disabled={busy || loading} onClick={() => void load()}>Tải lại</button></div>}{message && <p className="sr-success" role="status">{message}</p>}
    {loaded && <><div className="sr-upload"><div><strong>{transcript ? "Cập nhật bảng điểm mới" : "Thêm bảng điểm đầu tiên"}</strong><p>File scan/ảnh chưa được hỗ trợ.</p></div><label className="sr-file-label">Chọn file PDF<input ref={input} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={e => { const selected = e.target.files?.[0]; setError(""); setMessage(""); setConfirmed(false); if (!selected) { setFile(null); return; } if (!selected.name.toLowerCase().endsWith(".pdf") || selected.size > 5 * 1024 * 1024 || !selected.size) { setError("Chọn file PDF không rỗng, tối đa 5 MB."); clearFile(); return; } setFile(selected); }} /></label></div>
      {file && <div className="sr-pending"><p><strong>{file.name}</strong> · {(file.size / 1024).toFixed(0)} KB</p>{transcript && <p>Bảng điểm mới sẽ thay thế PDF và toàn bộ dữ liệu bảng điểm hiện tại sau khi đọc thành công.</p>}<label className="sr-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Tôi xác nhận đây là bảng điểm của mình. Hệ thống không xác minh chủ sở hữu từ PDF.</label><div className="sr-actions"><button className="sw-primary" disabled={busy || !confirmed} onClick={() => void upload()}>{busy ? "Đang đọc và lưu PDF…" : transcript ? "Cập nhật bảng điểm" : "Import bảng điểm"}</button><button className="sr-secondary" disabled={busy} onClick={clearFile}>Hủy chọn</button></div></div>}
      {transcript ? <><div className="sr-file-info"><div><strong>{transcript.filename}</strong><p>{transcript.data.pageCount} trang · {transcript.data.courseCount} dòng học phần · Cập nhật {new Date(transcript.updatedAt).toLocaleString("vi-VN")}</p></div><div className="sr-file-actions"><a href="/api/student/transcript/file">Tải PDF</a><button onClick={exportJson}>Tải JSON</button><button className="sr-danger" disabled={busy} onClick={() => void remove()}>Xóa bảng điểm</button></div></div><div className="sr-table-filters"><label>Học kỳ<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Tất cả học kỳ</option>{transcript.data.sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label><label>Tìm học phần<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Mã hoặc tên môn học…" /></label><span>{count} dòng học phần</span></div>
        {sections.map(section => { const courses = section.courses.filter(matches); if (!courses.length) return null; return <section className="sr-term" key={section.id}><h3>{section.label}</h3><div className="sr-table-scroll" tabIndex={0} role="region" aria-label={`Bảng điểm ${section.label}`}><table><thead><tr><th scope="col">STT</th><th scope="col">Mã môn học</th><th scope="col">Tên môn học</th><th scope="col">Tín chỉ</th><th scope="col">Hệ 10</th><th scope="col">Hệ 4</th><th scope="col">Điểm chữ</th><th scope="col">Kết quả</th></tr></thead><tbody>{courses.map(course => <tr key={`${course.sourcePage}-${course.ordinal}`}><td>{course.ordinal}</td><td>{course.code}</td><td>{course.name}</td><td>{course.credits}</td><td>{course.score10 ?? "—"}</td><td>{course.score4 === null ? "—" : course.score4.toFixed(2)}</td><td><span className={course.letter === "F" ? "sr-grade-fail" : "sr-grade"}>{course.letter ?? "—"}</span></td><td>{course.result ?? "—"}</td></tr>)}</tbody></table></div>{section.summaries.length > 0 && <dl className="sr-summaries">{section.summaries.map((summary, i) => <div key={i}><dt>{summary.label}</dt><dd>{summary.value ?? "—"}</dd></div>)}</dl>}</section>; })}{!count && <p className="sw-empty">Không tìm thấy học phần phù hợp.</p>}<p className="sw-muted">(*) Môn điều kiện theo ghi chú PDF. Các tổng kết học kỳ được đọc nguyên từ trường, không tính lại từ các hàng đang lọc.</p>
      </> : !file && <div className="sw-empty"><h3>Chưa có bảng điểm</h3><p>Chọn file PDF ở trên để bắt đầu. Bảng điểm sẽ được lưu riêng trong tài khoản của bạn.</p></div>}</>}
  </section>;
}
