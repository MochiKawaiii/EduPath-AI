import { useState } from "react";
import type { GraduationData } from "./graduation-types";
import { searchTerm } from "./student-curriculum-types";
import { useLiveData } from "./use-live-data";
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
const fmt = (n: number | null) => (n === null ? "Chưa xác định" : String(n));
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
      {selected && <StandardContents key={selected.id} id={selected.id} />}
    </div>
  );
}
function StandardContents({ id }: { id: string }) {
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
              </dd>
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
      <section className="sw-panel sg-groups">
        <div className="sg-groups-heading">
          <div>
            <h2>Các nhóm học phần</h2>
            <p className="sc-muted">
              Môn điều kiện (*) phải đạt nhưng không tính vào tín chỉ tích lũy
              và điểm trung bình.
            </p>
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
          if (query && !items.length) return null;
          return (
            <div key={group.id} className="sg-group">
              <div className="sg-group-heading">
                <h3>{group.name}</h3>
                <span
                  className={`sc-badge ${group.kind === "elective" ? "sc-elective" : ""}`}
                >
                  {group.kind === "mandatory" ? "Bắt buộc" : "Tự chọn"} · Yêu
                  cầu {fmt(group.minimumCredits)} TC
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
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => (
                      <tr key={c.id}>
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
                      </tr>
                    ))}
                    {!items.length && (
                      <tr>
                        <td colSpan={4} className="sc-muted">
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
