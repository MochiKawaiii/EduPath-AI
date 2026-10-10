import { useEffect, useRef, useState } from "react";
import { Icon } from "./admin-account-shared";
import { COMPETENCY_API, competencyRequest, importActionLabels, percentage, type CurriculumRevision, type ImportCounts, type ImportIssue, type ImportPreview, type ImportResult } from "./competency-types";

const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const countLabels: Record<keyof ImportCounts, string> = {
  skillRows: "Dòng kỹ năng nguồn", linkRows: "Dòng liên kết nguồn", courses: "Học phần trong tệp", validRows: "Dòng hợp lệ", errorRows: "Dòng có lỗi", groupsToCreate: "Nhóm tạo mới", skillsToCreate: "Kỹ năng tạo mới", skillsToReuse: "Kỹ năng chung dùng lại", legacySkillsMapped: "ID đánh giá cũ được nối", skillsToUpdate: "Hồ sơ kỹ năng cập nhật", coursesToCreate: "Cấu hình tạo mới", coursesToUpdate: "Cấu hình cập nhật", coursesUnchanged: "Cấu hình không thay đổi", linksToCreate: "Liên kết tạo mới", linksToUpdate: "Liên kết cập nhật", linksToRemove: "Liên kết gỡ bỏ",
};
type PreviewSource = { file: File; buffer: ArrayBuffer; revisionId: string; cohort: string; token: string };

export function CompetencyImportTab({ curriculum, canManage, revision, onSaved, onBusyChange }: { curriculum: CurriculumRevision; canManage: boolean; revision: number; onSaved: () => void; onBusyChange: (busy: boolean) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceCohort, setSourceCohort] = useState(curriculum.cohortCode);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState("");
  const source = useRef<PreviewSource | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);

  function invalidate(clearResult = true) {
    generation.current += 1;
    controller.current?.abort(); controller.current = null;
    source.current = null;
    setPreview(null); setConfirmWarnings(false); setConfirmOverwrite(false); setBusy(null); setError("");
    if (clearResult) setResult(null);
  }
  useEffect(() => {
    invalidate(false);
    return () => { generation.current += 1; controller.current?.abort(); };
    // Every successful edit elsewhere makes an outstanding preview require a fresh check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, curriculum.revisionId]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const normalizedCohort = sourceCohort.trim().toUpperCase();
  const sourceValid = /^K\d+$/u.test(normalizedCohort) && normalizedCohort === curriculum.cohortCode.toUpperCase();
  const previewSource = source.current;
  const currentPreview = !!preview && !!previewSource && previewSource.file === file && previewSource.revisionId === curriculum.revisionId && previewSource.cohort === normalizedCohort && previewSource.token === preview.token;
  const mayImport = canManage && !!currentPreview && !!preview?.canImport && !preview.errors.length && (!preview.warnings.length || confirmWarnings) && (!preview.requiresOverwrite || confirmOverwrite);

  async function inspect() {
    if (!file || busy || !canManage) return;
    if (!/\.xlsx$/iu.test(file.name)) { setError("Hãy chọn tệp Excel có phần mở rộng .xlsx."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Tệp vượt giới hạn 5 MB. Hãy chọn tệp Excel nhỏ hơn."); return; }
    if (!sourceValid) { setError("Khóa nguồn phải trùng với khóa của phiên bản chương trình đã chọn."); return; }
    invalidate();
    const requestGeneration = generation.current;
    const activeController = new AbortController(); controller.current = activeController;
    setBusy("preview");
    try {
      const buffer = await file.arrayBuffer();
      if (requestGeneration !== generation.current || activeController.signal.aborted) return;
      const checked = await competencyRequest<ImportPreview>(`${COMPETENCY_API}/import/preview`, { method: "POST", headers: { "Content-Type": mime, "x-revision-id": curriculum.revisionId, "x-source-cohort": normalizedCohort, "x-filename": encodeURIComponent(file.name) }, body: buffer, signal: activeController.signal });
      if (requestGeneration !== generation.current || activeController.signal.aborted) return;
      source.current = { file, buffer, revisionId: curriculum.revisionId, cohort: normalizedCohort, token: checked.token };
      setPreview(checked);
    } catch (failure) { if (requestGeneration === generation.current && !activeController.signal.aborted) setError((failure as Error).message); }
    finally { if (requestGeneration === generation.current) { controller.current = null; setBusy(null); } }
  }
  async function apply() {
    const checkedSource = source.current;
    if (!mayImport || !checkedSource || !preview || busy) return;
    const requestGeneration = generation.current;
    const activeController = new AbortController(); controller.current = activeController;
    setBusy("import"); onBusyChange(true); setError("");
    try {
      const imported = await competencyRequest<ImportResult>(`${COMPETENCY_API}/import`, { method: "POST", headers: { "Content-Type": mime, "x-revision-id": checkedSource.revisionId, "x-source-cohort": checkedSource.cohort, "x-filename": encodeURIComponent(checkedSource.file.name), "x-preview-token": checkedSource.token, ...(confirmWarnings ? { "x-confirm-warnings": "true" } : {}), ...(confirmOverwrite ? { "x-confirm-overwrite": "true" } : {}) }, body: checkedSource.buffer, signal: activeController.signal });
      if (requestGeneration !== generation.current || activeController.signal.aborted) return;
      source.current = null; setPreview(null); setResult(imported); setConfirmWarnings(false); setConfirmOverwrite(false); onSaved();
    } catch (failure) {
      if (requestGeneration === generation.current && !activeController.signal.aborted) {
        source.current = null; setPreview(null); setConfirmWarnings(false); setConfirmOverwrite(false);
        setError(`${(failure as Error).message}\nHãy xem trước lại để xác nhận dữ liệu hiện tại.`);
      }
    } finally { onBusyChange(false); if (requestGeneration === generation.current) { controller.current = null; setBusy(null); } }
  }

  return <section className="cm-panel comp-import-panel cm-form">
    <div><h2>Nhập danh mục và trọng số từ Excel</h2><p className="comp-hint">Tệp .xlsx tối đa 5 MB, gồm trang <strong>skills</strong> và <strong>course_skills</strong>. Kiểm tra toàn bộ lỗi, cảnh báo và thay đổi trước khi xác nhận nhập vào {curriculum.cohortCode} · phiên bản {curriculum.version}.</p></div>
    {!canManage ? <p className="comp-hint">Tài khoản của bạn được xem cấu hình. Chỉ người có quyền quản trị mới được nhập dữ liệu.</p> : <>
      <div className="cm-form-grid">
        <label className="cm-upload">Tệp nguồn Excel<input type="file" accept=".xlsx" disabled={busy === "import"} onChange={event => { invalidate(); setFile(event.target.files?.[0] ?? null); }} />{file && <span>{file.name} · {(file.size / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} KB</span>}</label>
        <label>Khóa nguồn<input value={sourceCohort} maxLength={20} disabled={busy === "import"} placeholder="Ví dụ: K29" onChange={event => { invalidate(); setSourceCohort(event.target.value); }} /><small>Nhập rõ khóa của tệp. Khóa nguồn phải trùng với {curriculum.cohortCode}; mã khóa trong tên tệp cũng được đối chiếu.</small></label>
      </div>
      {!sourceValid && <p className="cm-warning" role="alert">Khóa nguồn phải theo dạng K29 và trùng với khóa {curriculum.cohortCode} đã chọn.</p>}
      <div className="cm-actions comp-preview-actions"><button className="am-outline" disabled={!file || !!busy || !sourceValid} onClick={() => void inspect()}><Icon name="eye" />{busy === "preview" ? "Đang đọc và kiểm tra…" : "Xem trước và kiểm tra"}</button>{busy && <span role="status">{busy === "import" ? "Đang nhập toàn bộ dữ liệu…" : "Đang phân tích tệp Excel…"}</span>}</div>
    </>}
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    {result && <div className="cm-success" role="status"><strong>{result.unchanged ? "Dữ liệu đã giống tệp nguồn; không có thay đổi cần ghi." : "Đã nhập dữ liệu đánh giá năng lực thành công."}</strong><p>{curriculum.cohortCode} · phiên bản {curriculum.version} · {result.summary.skillsToCreate} kỹ năng mới · {result.summary.skillsToUpdate} hồ sơ cập nhật · {result.summary.coursesToCreate} cấu hình mới · {result.summary.coursesToUpdate} cấu hình cập nhật.</p></div>}
    {preview && currentPreview && <>
      <div className="comp-preview-heading"><h3>Bản xem trước: {preview.filename}</h3><span>{preview.cohortCode} · phiên bản {curriculum.version}</span></div>
      <dl className="comp-import-counts">{Object.entries(countLabels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{preview.counts[key as keyof ImportCounts]}</dd></div>)}<div><dt>Lỗi kiểm tra</dt><dd>{preview.errors.length}</dd></div><div><dt>Cảnh báo</dt><dd>{preview.warnings.length}</dd></div></dl>
      <IssueList title="Lỗi phải sửa" items={preview.errors} errors />
      <IssueList title="Cảnh báo cần rà soát" items={preview.warnings} />
      <ImportChanges preview={preview} />
      {!preview.canImport && <p className="admin-error" role="alert">Bản xem trước chưa đủ điều kiện nhập. Hãy sửa tất cả lỗi trong tệp rồi xem trước lại.</p>}
      {preview.warnings.length > 0 && <label className="comp-check"><input type="checkbox" checked={confirmWarnings} disabled={!!busy} onChange={event => setConfirmWarnings(event.target.checked)} /><span>Tôi đã rà soát toàn bộ {preview.warnings.length} cảnh báo và xác nhận dùng dữ liệu của tệp nguồn.</span></label>}
      {preview.requiresOverwrite && <div className="cm-warning"><p>Tệp sẽ cập nhật hồ sơ hoặc cấu hình đã có thay đổi thủ công. Kiểm tra các dòng “Cập nhật” trước khi cho phép ghi đè.</p><label className="comp-check"><input type="checkbox" checked={confirmOverwrite} disabled={!!busy} onChange={event => setConfirmOverwrite(event.target.checked)} /><span>Tôi xác nhận ghi đè các thay đổi được liệt kê trong bản xem trước.</span></label></div>}
      <div className="cm-actions comp-preview-actions"><button className="am-primary" disabled={!!busy || !mayImport} onClick={() => void apply()}><Icon name="save" />{busy === "import" ? "Đang nhập…" : "Xác nhận nhập dữ liệu"}</button><span className="comp-hint">Nhập đồng thời toàn bộ tệp sau khi kiểm tra. Thay tệp, khóa hoặc phiên bản sẽ yêu cầu xem trước lại.</span></div>
    </>}
  </section>;
}

function IssueList({ title, items, errors = false }: { title: string; items: ImportIssue[]; errors?: boolean }) {
  if (!items.length) return <p className="comp-hint">{title}: không có.</p>;
  return <section className={errors ? "comp-import-errors" : "cm-warning"}><h3>{title} ({items.length})</h3><ul tabIndex={0} aria-label={title}>{items.map((item, index) => <li key={`${item.sheet}-${item.row}-${item.code}-${index}`}><strong>{item.sheet || "Tệp nguồn"}{item.row !== null ? ` · dòng ${item.row}` : ""}: </strong>{item.message}</li>)}</ul></section>;
}

function ImportChanges({ preview }: { preview: ImportPreview }) {
  return <div className="comp-section-stack">
    <section className="comp-section"><h3>Thay đổi danh mục kỹ năng ({preview.skills.length})</h3><div className="cm-table-scroll comp-preview-scroll" tabIndex={0} role="region" aria-label="Thay đổi kỹ năng khi nhập Excel"><table className="cm-table"><thead><tr><th>Kỹ năng trong tệp</th><th>Nhóm nguồn</th><th>Phạm vi từ tệp</th><th>Thay đổi</th></tr></thead><tbody>{preview.skills.map((skill, index) => <tr key={`${skill.name}-${index}`}><td><strong>{skill.name}</strong>{skill.legacySkillId && <small>Giữ liên kết với hồ sơ đánh giá cũ.</small>}</td><td>{skill.group}</td><td className="comp-description">{skill.scope || "Chưa bổ sung"}</td><td><span className={`comp-state comp-action-${skill.action}`}>{importActionLabels[skill.action]}</span>{(skill.previousScope !== undefined || skill.previousGroup !== undefined) && <details className="comp-diff"><summary>Đối chiếu nhóm và phạm vi nguồn</summary><dl><dt>Hiện tại</dt><dd>{skill.previousGroup ?? skill.group}<p className="cm-prewrap">{skill.previousScope || "Chưa bổ sung phạm vi"}</p></dd><dt>Trong tệp nguồn</dt><dd>{skill.group}<p className="cm-prewrap">{skill.scope || "Chưa bổ sung phạm vi"}</p></dd></dl></details>}</td></tr>)}</tbody></table></div></section>
    <section className="comp-section"><h3>Thay đổi cấu hình học phần ({preview.courses.length})</h3><div className="cm-table-scroll comp-preview-scroll" tabIndex={0} role="region" aria-label="Thay đổi học phần khi nhập Excel"><table className="cm-table"><thead><tr><th>Học phần</th><th>Liên kết trong tệp</th><th>Tổng trọng số mới</th><th>Thay đổi</th></tr></thead><tbody>{preview.courses.map(course => <tr key={course.courseCode}><td><strong>{course.courseCode}</strong>{course.courseName}</td><td>{course.rowCount}</td><td>{percentage(course.totalWeight)}</td><td><span className={`comp-state comp-action-${course.action}`}>{importActionLabels[course.action]}</span>{course.changes && course.changes.length > 0 && <details className="comp-diff"><summary>So sánh {course.changes.length} trọng số</summary><div className="cm-table-scroll" tabIndex={0} role="region" aria-label="So sánh trọng số trước và sau khi nhập"><table className="cm-table comp-diff-table"><thead><tr><th>Kỹ năng</th><th>Trước</th><th>Sau</th></tr></thead><tbody>{course.changes.map((change, index) => <tr key={`${change.skillName}-${index}`}><td>{change.skillName}</td><td>{change.beforeWeight === null ? "Chưa liên kết" : percentage(change.beforeWeight)}</td><td>{change.afterWeight === null ? "Gỡ liên kết" : percentage(change.afterWeight)}</td></tr>)}</tbody></table></div></details>}</td></tr>)}</tbody></table></div></section>
  </div>;
}
