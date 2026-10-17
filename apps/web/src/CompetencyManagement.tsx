import { useState } from "react";
import { Status } from "./admin-ui";
import { CompetencyGroupsTab, CompetencySkillsTab } from "./CompetencyProfiles";
import { CompetencyCoursesTab } from "./CompetencyCourses";
import { COMPETENCY_API, useCompetencyData, type CurriculumRevision } from "./competency-types";
import "./curricula.css";
import "./competencies.css";

/**
 * The three pages of "Quản lý năng lực", in the order they depend on each other: Nhóm năng lực, then
 * Cấu hình năng lực (the skills that are assessed, each in a group), then Cấu hình học phần (which
 * course trains which skill, and how much).
 */
export type CompetencySection = "groups" | "profiles" | "courses";

export default function CompetencyManagement({ canManage, section }: { canManage: boolean; section: CompetencySection }) {
  const [revision, setRevision] = useState(0);
  const saved = () => setRevision(value => value + 1);
  return <section className="cm-workspace comp-workspace">
    {section === "groups" && <CompetencyGroupsTab canManage={canManage} revision={revision} onSaved={saved} />}
    {section === "profiles" && <CompetencySkillsTab canManage={canManage} revision={revision} onSaved={saved} />}
    {section === "courses" && <CourseConfiguration canManage={canManage} revision={revision} onSaved={saved} />}
  </section>;
}

/** "Cấu hình học phần": pick a cohort and a CTĐT revision, then link skills to its courses and weigh them. */
function CourseConfiguration({ canManage, revision, onSaved }: { canManage: boolean; revision: number; onSaved: () => void }) {
  const [cohort, setCohort] = useState("");
  const [selection, setSelection] = useState<CurriculumRevision | null>(null);
  const curricula = useCompetencyData<{ items: CurriculumRevision[] }>(`${COMPETENCY_API}/curricula`, revision);
  const allRevisions = curricula.data?.items ?? [];
  const cohorts = [...new Set(allRevisions.map(item => item.cohortCode))];
  const selected = selection ? curricula.data ? allRevisions.find(item => item.revisionId === selection.revisionId && item.cohortCode === cohort) ?? null : selection : null;

  return <>
    <div className="cm-toolbar"><p>Gắn kỹ năng với từng học phần và chia trọng số theo khóa và phiên bản chương trình đào tạo; AI có thể đề xuất liên kết và trọng số.</p></div>
    <div className="cm-panel">
      <div className="comp-revision-selector cm-form">
        <div className="cm-form-grid">
          <label>Khóa tuyển sinh<select value={cohort} disabled={curricula.loading} onChange={event => { setCohort(event.target.value); setSelection(null); }}><option value="">Chọn khóa</option>{cohorts.map(code => <option key={code} value={code}>{code}</option>)}</select></label>
          <label>Phiên bản chương trình đào tạo<select value={selected?.revisionId ?? ""} disabled={!cohort || curricula.loading} onChange={event => setSelection(allRevisions.find(item => item.revisionId === event.target.value) ?? null)}><option value="">Chọn phiên bản cụ thể</option>{allRevisions.filter(item => item.cohortCode === cohort).map(item => <option key={item.revisionId} value={item.revisionId}>{item.name} · v{item.version} · {item.isCurrent ? "Hiện hành" : "Lịch sử"}{item.isActive ? "" : " · Khung ngừng sử dụng"}</option>)}</select></label>
        </div>
        <Status {...curricula} />
        {selected ? <p className="comp-revision-note"><strong>{selected.cohortCode} · Phiên bản {selected.version} · {selected.isCurrent ? "Hiện hành" : "Lịch sử"}</strong><span>{selected.courseCount} học phần · {selected.activeCount} cấu hình áp dụng · {selected.draftCount} bản nháp. Dữ liệu gắn với đúng phiên bản đã chọn.</span></p> : !curricula.loading && !curricula.error && <p className="comp-hint">{allRevisions.length ? "Chọn khóa và phiên bản để xem liên kết và trọng số của học phần." : "Chưa có chương trình đào tạo. Hãy thêm khung ở mục Chương trình trước."}</p>}
      </div>
    </div>
    {selected && <CompetencyCoursesTab key={selected.revisionId} curriculum={selected} canManage={canManage} revision={revision} onSaved={onSaved} />}
  </>;
}
