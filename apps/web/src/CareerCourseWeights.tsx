import { useState } from "react";
import { Icon } from "./admin-account-shared";
import { Modal, Status, useData } from "./admin-ui";
import { percentage } from "./competency-types";

type Revision = {
  revisionId: string; cohortCode: string; name: string; version: number;
  isCurrent: boolean; isActive: boolean; activeCount: number;
};
type CourseWeight = { skillId: string; scope: string; courseCode: string; courseName: string; weight: number };
type WeightResponse = { careerPositionId: string; revisionId: string | null; revisions: Revision[]; items: CourseWeight[] };
const revisionLabel = (item: Revision) => `${item.cohortCode} · ${item.name} · Phiên bản ${item.version}${item.isCurrent ? " (hiện hành)" : ""}`;

export function useCareerCourseWeights(careerId: string, revision: number) {
  const [revisionId, setRevisionId] = useState("");
  const remote = useData<WeightResponse>(`/api/admin/careers/requirements/course-weights?${new URLSearchParams({
    careerPositionId: careerId, ...(revisionId ? { revisionId } : {}),
  })}`, revision);
  // A changed URL can render once before the fetching effect clears its previous response.
  const data = remote.data?.careerPositionId === careerId && (!revisionId || remote.data.revisionId === revisionId) ? remote.data : null;
  return { remote, data, revisionId, setRevisionId };
}
type WeightState = ReturnType<typeof useCareerCourseWeights>;

export function CareerWeightSelector({ state }: { state: WeightState }) {
  const { remote, data, revisionId, setRevisionId } = state;
  const selected = data?.revisions.find(item => item.revisionId === data.revisionId);
  return <div className="career-weight-context">
    <div className="cm-form"><label>Trọng số học phần theo chương trình đào tạo
      <select value={revisionId || data?.revisionId || ""} disabled={!remote.data?.revisions.length}
        onChange={event => setRevisionId(event.target.value)}>
        {!remote.data?.revisions.length && <option value="">Chưa có chương trình đào tạo</option>}
        {remote.data?.revisions.map(item => <option key={item.revisionId} value={item.revisionId}>{revisionLabel(item)}</option>)}
      </select>
    </label></div>
    <p>Trọng số là tỷ lệ đóng góp của từng học phần vào kỹ năng, theo đúng khóa và phiên bản chương trình đã chọn.</p>
    <Status {...remote} />
    {selected && selected.activeCount === 0 && <p role="status">{selected.cohortCode} · Phiên bản {selected.version} chưa có cấu hình đánh giá đang áp dụng.</p>}
  </div>;
}

export function CareerWeightCell({ state, skillId, skillName }: { state: WeightState; skillId: string | null; skillName: string | null }) {
  const [open, setOpen] = useState(false);
  if (!skillId) return <span>Không liên kết kỹ năng</span>;
  if (state.remote.error) return <span>Chưa tải được trọng số</span>;
  if (!state.data || state.remote.loading) return <span>Đang tải…</span>;
  const selected = state.data.revisions.find(item => item.revisionId === state.data!.revisionId);
  if (!selected) return <span>Chưa có chương trình đào tạo</span>;
  const courses = state.data.items.filter(item => item.skillId === skillId);
  if (!courses.length) return <span className="career-weight-empty">Chưa có trọng số học phần<small>{selected.cohortCode} · Phiên bản {selected.version}</small></span>;
  return <>
    <button className="am-outline" type="button" onClick={() => setOpen(true)} aria-label={`Xem trọng số học phần của ${skillName}`}>
      <Icon name="eye" /> {courses.length} học phần
    </button>
    {open && <Modal title={`Trọng số học phần · ${skillName}`} onClose={() => setOpen(false)}>
      <div className="cm-dialog-body career-weight-detail">
        <p><strong>{revisionLabel(selected)}</strong></p>
        {courses[0]?.scope && <p>Phạm vi kỹ năng: {courses[0].scope}</p>}
        <p>Mỗi tỷ lệ thuộc phân bổ 100% của một học phần. Các tỷ lệ dưới đây không cộng thành trọng số của nghề nghiệp.</p>
        <div className="cm-table-scroll"><table className="cm-table">
          <thead><tr><th>Mã học phần</th><th>Tên học phần</th><th>Trọng số</th></tr></thead>
          <tbody>{courses.map(course => <tr key={course.courseCode}>
            <td>{course.courseCode}</td><td>{course.courseName}</td><td><strong>{percentage(course.weight)}</strong></td>
          </tr>)}</tbody>
        </table></div>
        <div className="cm-actions cm-dialog-actions"><button className="am-outline" type="button" onClick={() => setOpen(false)}><Icon name="close" /> Đóng</button></div>
      </div>
    </Modal>}
  </>;
}
