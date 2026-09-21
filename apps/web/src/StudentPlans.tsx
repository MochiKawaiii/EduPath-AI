import { useEffect, useState } from "react";
import type { PlanData, PlanItem } from "./plan-types";
import { searchTerm } from "./student-curriculum-types";
import "./student-curriculum.css";
import "./student-plans.css";

type List = {
  items: { id: string; name: string; cohortCode: string; major: string }[];
  suggestedId: string | null;
  profileCohort: string | null;
};
type Detail = Pick<
  PlanData,
  "name" | "major" | "cohortCode" | "totalCredits" | "terms" | "sections"
> & {
  items: Omit<
    PlanItem,
    "position" | "sourceRow" | "sourceSheet" | "sourceCells"
  >[];
};
function useData<T>(url: string, reload: number) {
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    loading: boolean;
  }>({ data: null, error: "", loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, error: "", loading: true });
    void fetch(url, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "Kế hoạch không còn được mở. Hãy tải lại danh sách."
              : response.status === 401
                ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
                : "Không thể tải kế hoạch đào tạo. Vui lòng thử lại.",
          );
        return response.json() as Promise<T>;
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, error: "", loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ data: null, error: error.message, loading: false });
      });
    return () => controller.abort();
  }, [url, reload]);
  return state;
}
export default function StudentPlans() {
  const [reload, setReload] = useState(0),
    [choice, setChoice] = useState<string | null>(null);
  const list = useData<List>("/api/student/plans", reload);
  useEffect(() => {
    const refresh = () => setReload((n) => n + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const id = choice ?? list.data?.suggestedId ?? "";
  const selected = list.data?.items.find((item) => item.id === id);
  return (
    <div className="sc-workspace">
      <section className="sw-panel sc-selector sp-selector">
        <div>
          <p className="sc-eyebrow">KẾ HOẠCH ĐÀO TẠO</p>
          <h2>Tra cứu kế hoạch theo học kỳ</h2>
          <p className="sc-muted">
            Xem các môn học dự kiến trong từng năm học, học kỳ của khóa tuyển
            sinh.
          </p>
        </div>
        <div className="sc-selector-controls">
          <label>
            Kế hoạch đang mở
            <select
              value={selected?.id ?? ""}
              onChange={(e) => setChoice(e.target.value)}
              disabled={list.loading}
            >
              <option value="">Chọn kế hoạch đào tạo</option>
              {list.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.cohortCode} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="sw-primary"
            onClick={() => setReload((n) => n + 1)}
          >
            Tải lại
          </button>
        </div>
        {list.loading && <p role="status">Đang tải kế hoạch…</p>}
        {list.error && <p role="alert">{list.error}</p>}
        {list.data && !list.data.items.length && (
          <p>Chưa có kế hoạch đào tạo đang mở.</p>
        )}
        {list.data && !!list.data.items.length && (
          <p className="sc-muted">
            {selected?.cohortCode === list.data.profileCohort
              ? "Kế hoạch cùng khóa tuyển sinh của bạn."
              : "Bạn có thể chọn kế hoạch của khóa khác để tham khảo."}{" "}
            Đây là kế hoạch giảng dạy, không phải danh sách môn bạn đã đăng ký.
          </p>
        )}
      </section>
      {selected && (
        <PlanContents key={selected.id} id={selected.id} reload={reload} />
      )}
    </div>
  );
}
function PlanContents({ id, reload }: { id: string; reload: number }) {
  const remote = useData<Detail>(`/api/student/plans/${id}`, reload);
  const [query, setQuery] = useState(""),
    [term, setTerm] = useState("");
  if (remote.loading)
    return (
      <section className="sw-panel" role="status">
        Đang tải nội dung kế hoạch…
      </section>
    );
  if (remote.error)
    return (
      <section className="sw-panel" role="alert">
        {remote.error}
      </section>
    );
  const data = remote.data!;
  const rows = data.items.filter(
    (item) =>
      (!term || item.termCode === term) &&
      searchTerm(`${item.code} ${item.name}`).includes(searchTerm(query)),
  );
  return (
    <section className="sw-panel sp-content">
      <h2>{data.name}</h2>
      <p>
        {data.major} · {data.cohortCode} · Tổng tín chỉ quy định:{" "}
        {data.totalCredits ?? "Chưa xác định"}
      </p>
      <div className="sc-filters">
        <label className="sc-search">
          Tìm môn học
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Mã hoặc tên học phần…"
          />
        </label>
        <label>
          Năm học · Học kỳ
          <select value={term} onChange={(e) => setTerm(e.target.value)}>
            <option value="">Tất cả học kỳ</option>
            {data.terms.map((t) => (
              <option key={t.code} value={t.code}>
                Năm {t.studyYear} · Học kỳ {t.semester}
              </option>
            ))}
          </select>
        </label>
        <button
          className="sw-primary"
          onClick={() => {
            setQuery("");
            setTerm("");
          }}
        >
          Xóa bộ lọc
        </button>
      </div>
      <p role="status">
        {rows.length} / {data.items.length} học phần
      </p>
      {data.terms
        .filter((t) => !term || term === t.code)
        .map((t) => {
          const items = rows.filter((item) => item.termCode === t.code);
          if (!items.length) return null;
          return (
            <div key={t.code}>
              <h3>
                Năm {t.studyYear} · Học kỳ {t.semester}
              </h3>
              <p className="sc-muted">
                Tín chỉ học kỳ theo kế hoạch:{" "}
                {t.sourceCredits ?? "Chưa xác định"}
              </p>
              <div className="sc-table-wrap">
                <table className="sc-table">
                  <thead>
                    <tr>
                      <th>Mã học phần</th>
                      <th>Tên học phần</th>
                      <th>TC</th>
                      <th>Loại</th>
                      <th>Điều kiện học</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.code || "—"}</td>
                        <td>
                          <strong>{item.name}</strong>
                          <small>
                            {
                              data.sections.find((s) => s.id === item.sectionId)
                                ?.label
                            }
                          </small>
                          {item.notes && <small>{item.notes}</small>}
                        </td>
                        <td>{item.credits ?? "—"}</td>
                        <td>{item.type || "—"}</td>
                        <td>
                          {item.prerequisite && (
                            <div>Tiên quyết: {item.prerequisite}</div>
                          )}
                          {item.prior && <div>Học trước: {item.prior}</div>}
                          {!item.prerequisite && !item.prior && "Chưa cung cấp"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      {!rows.length && <p>Không có môn học phù hợp với bộ lọc.</p>}
    </section>
  );
}
