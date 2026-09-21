import { useEffect, useState } from "react";
import type { Transcript } from "./StudentTranscript";
import { academicSections, latestResultSection, printedSemesterGpa } from "./student-overview-data";
import { Icon } from "./student-icons";

export type StudentProfile = {
  name: string; studentCode: string | null; cohortCode: string | null;
  className: string | null; cohortYear: number | null; currentSemester: number | null;
  email: string | null; careerGoal: string | null; interests: string | null; profileStatus: string;
};

export default function StudentOverview({ profile, loading: profileLoading, navigate }: {
  profile: StudentProfile | null; loading: boolean;
  navigate: (page: "profile" | "career" | "roadmap" | "competency") => void;
}) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/student/transcript", { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : "Chưa tải được kết quả học tập.");
        return response.json() as Promise<{ transcript: Transcript | null }>;
      })
      .then(data => { if (!controller.signal.aborted) { setTranscript(data.transcript); setSelectedId(latestResultSection(academicSections(data.transcript))?.id ?? ""); } })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Chưa tải được bảng điểm."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  const semesters = academicSections(transcript);
  const semester = semesters.find(item => item.id === selectedId);
  const gpa = printedSemesterGpa(semester);
  const checklist = [
    { label: "Thông tin lớp học", done: Boolean(profile?.className?.trim()) },
    { label: "Bảng điểm học tập", done: Boolean(transcript) },
    { label: "Sở thích cá nhân", done: Boolean(profile?.interests?.trim()) },
    { label: "Mục tiêu nghề nghiệp", done: Boolean(profile?.careerGoal?.trim()) }
  ];
  const ready = checklist.filter(item => item.done).length;
  const readyKnown = !loading && !profileLoading && !error && profile !== null;
  return <div className="so-overview">
    <div className="sw-section-heading"><h2>Không gian học tập của bạn</h2><span className="sw-muted">Mỗi bước nhỏ, một hướng đi rõ hơn</span></div>
    <div className="so-quick-grid">
      <article className="so-quick-card">
        <div className="so-card-heading"><span className="so-kicker">THEO DÕI</span><span className={`sw-tag ${transcript && !error ? "sw-tag-green" : ""}`}>{loading ? "Đang tải" : error ? "Chưa kết nối" : transcript ? "Đã có bảng điểm" : "Chưa có dữ liệu"}</span></div>
        <h3>Kết quả học tập</h3><p>Bảng điểm và học phần, cùng một nơi.</p>
        <dl className="so-card-metrics"><div><dt>Môn học</dt><dd>{loading || error ? "—" : transcript?.data.courseCount ?? "—"}</dd></div><div><dt>Học kỳ đã import</dt><dd>{loading || error || !transcript ? "—" : semesters.length}</dd></div></dl>
        <button className="so-card-link" onClick={() => navigate("profile")}>{transcript ? "Xem bảng điểm" : "Import bảng điểm"}<span aria-hidden="true">↗</span></button>
      </article>
      <article className="so-quick-card">
        <div className="so-card-heading"><span className="so-kicker">KHÁM PHÁ</span><span className="sw-tag">Mục tiêu cá nhân</span></div>
        <h3>Định hướng của bạn</h3><p>Kết nối điều bạn thích với điều muốn làm.</p>
        <div className="so-card-detail"><small>Mục tiêu nghề nghiệp</small><strong>{profileLoading ? "Đang tải hồ sơ…" : profile?.careerGoal || "Bạn muốn phát triển theo hướng nào?"}</strong></div>
        <button className="so-card-link" onClick={() => navigate("profile")}>{profile?.careerGoal ? "Cập nhật mục tiêu" : "Thêm mục tiêu của bạn"}<span aria-hidden="true">↗</span></button>
      </article>
      <article className="so-quick-card">
        <div className="so-card-heading"><span className="so-kicker">LÊN KẾ HOẠCH</span><span className="sw-tag">Sắp ra mắt</span></div>
        <h3>Lộ trình học tập</h3><p>Chuẩn bị cho những học kỳ tiếp theo.</p>
        <div className="so-card-detail"><small>Kế hoạch của bạn</small><strong>Chưa có lộ trình</strong><span>Gợi ý môn học và kỹ năng sẽ được bổ sung tại đây.</span></div>
        <button className="so-card-link" onClick={() => navigate("roadmap")}>Tìm hiểu lộ trình<span aria-hidden="true">↗</span></button>
      </article>
    </div>
    <div className="so-columns">
      <section className="sw-panel so-results" aria-labelledby="recent-results-title">
        <div className="sw-section-heading"><div><h2 id="recent-results-title">Kết quả học tập gần nhất</h2><p className="sw-muted">Các học phần trong bảng điểm bạn đã import.</p></div>{semesters.length > 0 && !error && <label className="so-term-select"><span className="sr-only">Chọn học kỳ</span><select value={selectedId} onChange={event => setSelectedId(event.target.value)}>{[...semesters].reverse().map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}</div>
        {loading ? <div className="so-loading" role="status"><p>Đang tải kết quả học tập…</p><div /><div /><div /></div> : error ? <div className="sw-empty" role="alert"><h3>{error}</h3><p>Bạn có thể tải lại để tiếp tục xem bảng điểm.</p><button className="sw-outline" onClick={() => setReload(value => value + 1)}><Icon name="refresh" />Tải lại kết quả</button></div> : semester ? <>
          <div className="so-table-wrap" tabIndex={0} role="region" aria-label={`Học phần ${semester.label}`}><table className="so-course-table"><thead><tr><th scope="col">Học phần</th><th scope="col">Tín chỉ</th><th scope="col">Hệ 10</th><th scope="col">Điểm chữ</th></tr></thead><tbody>{semester.courses.map(course => <tr key={`${course.sourcePage}-${course.ordinal}`}><td><strong>{course.name}</strong><span>{course.code}</span></td><td>{course.credits}</td><td>{course.score10 ?? "—"}</td><td><span className={`so-grade ${course.letter === "F" ? "so-grade-fail" : ""}`}>{course.letter ?? "—"}</span></td></tr>)}</tbody></table></div>
          <div className="so-results-footer"><span>Điểm TB học kỳ (hệ 4) <strong>{gpa ?? "Chưa có"}</strong></span><button className="sw-text-link" onClick={() => navigate("profile")}>Xem toàn bộ bảng điểm <span aria-hidden="true">→</span></button></div>
        </> : <div className="sw-empty so-transcript-empty"><span className="so-paper-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="10" y="5" width="28" height="38" rx="4" /><path d="M17 15h14M17 23h14M17 31h8" /></svg></span><h3>{transcript ? "Chưa có học phần theo học kỳ" : "Bắt đầu với bảng điểm của bạn"}</h3><p>{transcript ? "Xem điểm bảo lưu và các dữ liệu hiện có trong hồ sơ." : "Tải bảng điểm PDF để xem môn học, điểm số và kết quả từng học kỳ ngay tại đây."}</p><button className="sw-outline" onClick={() => navigate("profile")}>{transcript ? "Xem bảng điểm" : "Thêm bảng điểm PDF"}</button></div>}
      </section>
      <aside className="so-aside">
        <section className="sw-panel so-checklist"><div className="sw-section-heading"><h2>Hồ sơ sẵn sàng</h2><span className="so-check-count">{readyKnown ? `${ready}/4` : "—/4"}</span></div><p className="sw-muted">Thêm thông tin để EduPath hiểu bạn hơn.</p><progress max={4} value={readyKnown ? ready : 0} aria-label="Số mục hồ sơ đã bổ sung" /><ul>{checklist.map(item => <li key={item.label}><span className={`so-check ${readyKnown && item.done ? "so-check-done" : ""}`} aria-hidden="true">{readyKnown && item.done ? "✓" : ""}</span><span>{item.label}</span><span className="sr-only">{!readyKnown ? "Chưa xác định" : item.done ? "Đã bổ sung" : "Chưa bổ sung"}</span></li>)}</ul><button className="sw-text-link" onClick={() => navigate("profile")}>Hoàn thiện hồ sơ <span aria-hidden="true">→</span></button></section>
        <section className="so-guidance"><span className="so-kicker">GỢI Ý CHO BẠN</span><h2>Hiểu mình trước.<br />Chọn hướng đi sau.</h2><p>Sở thích và mục tiêu hôm nay là điểm bắt đầu cho hành trình học tập phù hợp với bạn.</p><button onClick={() => navigate("career")}>Khám phá định hướng <span aria-hidden="true">↗</span></button></section>
      </aside>
    </div>
  </div>;
}
