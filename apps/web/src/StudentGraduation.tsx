import { useState } from "react";
import type { GraduationData } from "./graduation-types";
import { searchTerm } from "./student-curriculum-types";
import { useLiveData } from "./use-live-data";
import type { Transcript } from "./StudentTranscript";
import { assessGraduation } from "./graduation-assessment";
import "./student-curriculum.css";
import "./student-graduation.css";

type List = {
  items: {
    id: string;
    name: string;
    cohortCode: string;
    major: string;
    specialty: string;
    classBlock: string;
    minimumCredits: number | null;
  }[];
  suggestedId: string | null;
  profileCohort: string | null;
};
type Detail = Omit<
  GraduationData,
  | "schemaVersion"
  | "standardCode"
  | "sourceWorkbook"
  | "sourceSheet"
  | "sourceNotes"
  | "groups"
  | "courses"
> & {
  groups: Omit<GraduationData["groups"][number], "sourceRow">[];
  courses: Omit<GraduationData["courses"][number], "sourceRow">[];
};
const fmt = (n: number | null) => (n === null ? "Chưa xác định" : n.toLocaleString("vi-VN", { maximumFractionDigits: 4 }));
async function readTranscript(response: Response): Promise<{ transcript: Transcript | null }> {
  if (!response.ok) throw new Error("Chưa tải được bảng điểm để xét điều kiện. Vui lòng thử lại.");
  return response.json();
}
const thresholds = [
  ["minimumCredits", "Tín chỉ tích lũy tối thiểu"],
  ["mandatoryCredits", "Tín chỉ bắt buộc"],
  ["electiveCredits", "Tín chỉ nhóm tự chọn"],
  ["freeElectiveCredits", "Tín chỉ tự chọn tự do"],
  ["minimumGpa", "Điểm TB tích lũy tối thiểu"],
] as const;
async function readStandard<T>(response: Response): Promise<T> {
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "Tiêu chuẩn này không còn được mở. Hãy chọn tiêu chuẩn khác."
        : response.status === 401
          ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
          : "Không thể tải điều kiện xét tốt nghiệp. Vui lòng thử lại.",
    );
  return response.json() as Promise<T>;
}
export default function StudentGraduation() {
  const [choice, setChoice] = useState<string | null>(null);
  const list = useLiveData<List>("/api/student/graduation", 0, readStandard);
  const id = choice ?? list.data?.suggestedId ?? "";
  const selected = list.data?.items.find((item) => item.id === id);
  return (
    <div className="sc-workspace">
      <section className="sw-panel sc-selector sg-selector">
        <div>
          <p className="sc-eyebrow">XÉT TỐT NGHIỆP</p>
          <h2>Tra cứu điều kiện tốt nghiệp</h2>
          <p className="sc-muted">
            Xem số tín chỉ, điểm trung bình tích lũy và các nhóm học phần cần
            hoàn thành để đủ điều kiện xét tốt nghiệp.
          </p>
        </div>
        <div className="sc-selector-controls">
          <label>
            Tiêu chuẩn đang áp dụng
            <select
              value={selected?.id ?? ""}
              onChange={(e) => setChoice(e.target.value)}
              disabled={list.loading || !list.data?.items.length}
            >
              <option value="">Chọn tiêu chuẩn xét tốt nghiệp</option>
              {list.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.cohortCode} · {item.name}
                  {item.classBlock ? ` · ${item.classBlock}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        {list.loading && (
          <p role="status" className="sc-muted">
            Đang tải tiêu chuẩn…
          </p>
        )}
        {list.error && (
          <p role="alert" className="sw-error">
            {list.error}
          </p>
        )}
        {list.data && (
          <p className="sc-selection-note">
            {!list.data.items.length
              ? "Chưa có tiêu chuẩn xét tốt nghiệp đang áp dụng. Vui lòng quay lại sau."
              : selected && selected.cohortCode === list.data.profileCohort
                ? `Tiêu chuẩn cùng khóa ${list.data.profileCohort} trong hồ sơ của bạn. Hãy đối chiếu ngành và lớp khi lựa chọn.`
                : selected
                  ? "Bạn đang tham khảo tiêu chuẩn của khóa khác."
                  : list.data.profileCohort
                    ? `Chọn tiêu chuẩn phù hợp với khóa ${list.data.profileCohort} và ngành học của bạn.`
                    : "Hồ sơ chưa có khóa học. Bạn có thể chọn một tiêu chuẩn để tham khảo."}{" "}
            Kết quả xét tốt nghiệp chính thức do nhà trường công bố.
          </p>
        )}
      </section>
      {selected && <StandardContents key={selected.id} id={selected.id} sameCohort={selected.cohortCode === list.data?.profileCohort} />}
    </div>
  );
}
function StandardContents({ id, sameCohort }: { id: string; sameCohort: boolean }) {
  const [revision, setRevision] = useState(0);
  const transcript = useLiveData<{ transcript: Transcript | null }>("/api/student/transcript", revision, readTranscript);
  const remote = useLiveData<Detail>(
    `/api/student/graduation/${id}`,
    0,
    readStandard,
  );
  const [query, setQuery] = useState("");
  if (remote.loading)
    return (
      <section className="sw-panel" role="status">
        Đang tải điều kiện xét tốt nghiệp…
      </section>
    );
  if (remote.error)
    return (
      <section className="sw-panel" role="alert">
        {remote.error}
      </section>
    );
  const data = remote.data!;
  const assessment = assessGraduation(data, transcript.data?.transcript ?? null);
  const assessmentReady = !transcript.loading && !transcript.error;
  const improvementCodes = new Set(data.courses.filter((course) => {
    const code = course.code.trim().toUpperCase();
    const grade = assessment.scores.get(code);
    const score = data.gpaScale === 4 ? grade?.score4 : grade?.score10;
    return assessment.gpa.status === "fail" && !course.conditionOnly && !grade?.conditional &&
      grade?.letter?.trim().toUpperCase() !== "MT" && assessment.results.get(code) === "pass" &&
      score !== null && score !== undefined && data.minimumGpa !== null && score < data.minimumGpa;
  }).map((course) => course.code.trim().toUpperCase()));
  const needle = searchTerm(query);
  const matches = data.courses.filter((c) =>
    searchTerm(`${c.code} ${c.name}`).includes(needle),
  );
  return (
    <>
      <section className="sw-panel sg-summary">
        <div>
          <p className="sc-eyebrow">{data.cohortCode}</p>
          <h2>{data.name}</h2>
          <p className="sc-muted">
            {[data.major, data.specialty, data.classBlock]
              .filter(Boolean)
              .join(" · ")}
            {data.educationSystem || data.faculty ? <br /> : null}
            {[data.educationSystem, data.faculty].filter(Boolean).join(" · ")}
          </p>
        </div>
        <dl className="sg-stats">
          {thresholds.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd className={data[key] === null ? "sg-unknown" : undefined}>
                {fmt(data[key])}
                {key === "minimumGpa" && data.gpaScale ? ` / ${data.gpaScale}` : ""}
              </dd>
              {key === "minimumGpa" && !data.gpaScale && <small className="sc-muted">Chưa chọn thang điểm</small>}
            </div>
          ))}
        </dl>
        {data.notes && (
          <div className="sc-condition">
            <h3>Ghi chú</h3>
            <p className="sc-prewrap">{data.notes}</p>
          </div>
        )}
      </section>
      <section className="sw-panel sg-assessment">
        <h2>Kết quả đối chiếu điều kiện tốt nghiệp</h2>
        {transcript.loading && <p role="status">Đang đối chiếu bảng điểm…</p>}
        {transcript.error && <p role="alert">{transcript.error} <button className="sw-outline" onClick={() => setRevision((n) => n + 1)}>Thử lại</button></p>}
        {assessmentReady && <>
          <p className={`sg-verdict sg-status-${sameCohort ? assessment.status : "unknown"}`} role="status">
            {!sameCohort ? "Chưa thể kết luận: tiêu chuẩn đang chọn không cùng khóa trong hồ sơ."
              : !transcript.data?.transcript ? "Chưa đủ dữ liệu xét tốt nghiệp. Hãy import bảng điểm để đối chiếu."
              : assessment.status === "pass" ? "Đã đạt các nhóm học phần và yêu cầu điểm trung bình theo tiêu chuẩn đang chọn."
              : assessment.status === "fail" ? "Chưa đủ điều kiện xét tốt nghiệp theo bảng điểm đã import."
              : "Chưa đủ dữ liệu để kết luận điều kiện xét tốt nghiệp."}
          </p>
          <p className="sc-muted">Nhóm bắt buộc phải đạt toàn bộ môn, kể cả môn (*). Nhóm tự chọn chỉ cần đạt đủ tín chỉ yêu cầu của nhóm, không phải học hết các lựa chọn. Môn (*) được tính để hoàn thành nhóm nhưng không cộng tín chỉ tích lũy. MT được tính đạt. Kết quả chính thức do nhà trường xác nhận.</p>
          {sameCohort && assessment.needsImprovement && <div className="sg-improvement" role="alert">
            <h3>Cần học cải thiện để nâng điểm trung bình</h3>
            <p>Bạn đã hoàn thành các nhóm học phần, nhưng điểm trung bình tích lũy hiện là <strong>{fmt(assessment.gpa.actual)} / {assessment.gpa.scale}</strong>, thấp hơn mức tối thiểu <strong>{fmt(assessment.gpa.required)} / {assessment.gpa.scale}</strong>. Bạn cần đăng ký học cải thiện hoặc học bổ sung các học phần được tính điểm trung bình theo quy định của trường.</p>
            <p>Xem điểm từng môn bên dưới để chọn môn cần cải thiện; ưu tiên những môn điểm thấp và có nhiều tín chỉ. Môn (*) và môn miễn thi (MT) không giúp nâng điểm trung bình.</p>
          </div>}
          {transcript.data?.transcript && assessment.gpa.status === "unknown" && <p className="sg-status-unknown">{assessment.gpa.reason}</p>}
          <div className="sc-table-wrap"><table className="sc-table sg-checks">
            <thead><tr><th>Điều kiện</th><th>Đã có</th><th>Yêu cầu</th><th>Kết quả</th></tr></thead>
            <tbody>{assessment.checks.map((check, index) => <tr key={index}>
              <td>{check.label}</td><td>{transcript.data?.transcript ? `${fmt(check.actual)} ${check.unit}` : "—"}</td><td>{fmt(check.required)} {check.unit}</td>
              <td className={`sg-status-${check.status}`}>{check.status === "pass" ? "✓ Đạt" : check.status === "fail" ? "✗ Chưa đạt" : "Chưa đủ dữ liệu"}</td>
            </tr>)}
              <tr>
                <td>Điểm trung bình tích lũy{assessment.gpa.scale ? ` (hệ ${assessment.gpa.scale})` : ""}</td>
                <td>{assessment.gpa.actual === null ? "—" : fmt(assessment.gpa.actual)}</td>
                <td>{fmt(assessment.gpa.required)}{assessment.gpa.scale ? ` / ${assessment.gpa.scale}` : ""}</td>
                <td className={`sg-status-${assessment.gpa.status}`}>{assessment.gpa.status === "pass" ? "✓ Đạt" : assessment.gpa.status === "fail" ? "✗ Chưa đạt" : "Chưa đủ dữ liệu"}</td>
              </tr>
            </tbody>
          </table></div>
          {assessment.gpa.source === "printed" && <p className="sc-muted">Điểm trung bình lấy từ dòng tích lũy trong bảng điểm của học kỳ có kết quả gần nhất.</p>}
          {assessment.gpa.source === "calculated" && <p className="sc-muted">Bảng điểm chưa có điểm trung bình tích lũy hệ {assessment.gpa.scale}. Điểm trên được tính tham khảo theo tín chỉ, lấy điểm cao nhất của mỗi mã môn một lần và bỏ môn (*)/MT. Không quy đổi giữa hệ 4 và hệ 10. Hãy đối chiếu với kết quả chính thức của trường.</p>}
        </>}
      </section>
      <section className="sw-panel sg-groups">
        <div className="sg-groups-heading">
          <div>
            <h2>Các nhóm học phần</h2>
            <p className="sc-muted">
              Môn (*) không cộng tín chỉ tích lũy. Trong nhóm bắt buộc phải đạt từng môn;
              trong nhóm tự chọn chỉ cần đạt đủ tín chỉ yêu cầu của nhóm.
            </p>
            <p className="sc-muted">Điểm hiển thị là điểm cao nhất trong các lần đạt; môn chưa đạt hiển thị điểm đã có. MT là miễn thi, không có điểm số để tính trung bình.</p>
          </div>
          <label className="sg-search">
            Tìm môn học
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Mã hoặc tên học phần…"
            />
          </label>
        </div>
        {query && (
          <p role="status" className="sc-muted">
            {matches.length} / {data.courses.length} học phần
          </p>
        )}
        {data.groups.map((group) => {
          const items = matches.filter((c) => c.groupId === group.id);
          const progress = assessment.checks.find((check) => check.groupId === group.id);
          const earnedCredits = group.kind === "mandatory"
            ? progress?.accumulatedCredits : progress?.actual;
          if (query && !items.length) return null;
          return (
            <div key={group.id} className="sg-group">
              <div className="sg-group-heading">
                <h3>{group.name}</h3>
                <span
                  className={`sc-badge ${group.kind === "elective" ? "sc-elective" : ""}`}
                >
                  {group.kind === "mandatory" ? "Bắt buộc" : "Tự chọn"} · Đã đạt:{" "}
                  {assessmentReady && transcript.data?.transcript ? fmt(earnedCredits ?? null) : "—"} TC
                  {" · "}Yêu cầu: {fmt(group.minimumCredits)} TC
                </span>
              </div>
              <div className="sc-table-wrap">
                <table className="sc-table">
                  <thead>
                    <tr>
                      <th>Mã học phần</th>
                      <th>Tên học phần</th>
                      <th>TC</th>
                      <th>Môn điều kiện</th>
                      <th className="sg-score">Điểm</th>
                      <th className="sg-result">Kết quả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => {
                      const result = assessmentReady && transcript.data?.transcript
                        ? assessment.results.get(c.code.trim().toUpperCase()) : undefined;
                      const grade = assessmentReady && transcript.data?.transcript
                        ? assessment.scores.get(c.code.trim().toUpperCase()) : undefined;
                      const improve = sameCohort && assessmentReady && improvementCodes.has(c.code.trim().toUpperCase());
                      return (
                      <tr key={c.id} className={improve ? "sg-course-improve" : undefined}>
                        <td>{c.code}</td>
                        <td>
                          <strong>{c.name}</strong>
                        </td>
                        <td>{c.credits ?? "—"}</td>
                        <td>
                          {c.conditionOnly
                            ? "Có (*) · không tính TC/GPA"
                            : "Không"}
                        </td>
                        <td className="sg-score">
                          {grade?.letter?.trim().toUpperCase() === "MT" ? <span>MT · Miễn thi</span>
                            : grade ? <>
                              <strong>{grade.score10 !== null ? `${fmt(grade.score10)} / 10` : grade.score4 !== null ? `${fmt(grade.score4)} / 4` : "Chưa có điểm"}</strong>
                              <small>{[grade.score10 !== null && grade.score4 !== null ? `${fmt(grade.score4)} / 4` : "", grade.letter].filter(Boolean).join(" · ")}</small>
                              {improve && <small className="sg-score-hint">Có thể học cải thiện</small>}
                            </> : "—"}
                        </td>
                        <td className={`sg-result ${result ? `sg-status-${result}` : "sc-muted"}`}>
                          {result === "pass" ? "✓ Đạt" : result === "fail" ? "✗ Chưa đạt" : "—"}
                        </td>
                      </tr>
                      );
                    })}
                    {!items.length && (
                      <tr>
                        <td colSpan={6} className="sc-muted">
                          Nhóm chưa có học phần.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {query && !matches.length && (
          <p>Không có học phần phù hợp với từ khóa.</p>
        )}
      </section>
    </>
  );
}
