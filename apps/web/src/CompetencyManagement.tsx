import { useState } from "react";
import { Icon } from "./admin-account-shared";
import { Status } from "./admin-ui";
import { CompetencyGroupsTab, CompetencySkillsTab } from "./CompetencyProfiles";
import { CompetencyCoursesTab } from "./CompetencyCourses";
import { CompetencyImportTab } from "./CompetencyImport";
import { COMPETENCY_API, useCompetencyData, type CurriculumRevision } from "./competency-types";
import "./curricula.css";
import "./competencies.css";

const tabs = [
  { id: "groups", label: "Nhóm kỹ năng", icon: "book" },
  { id: "profiles", label: "Danh mục kỹ năng", icon: "profile" },
  { id: "courses", label: "Trọng số học phần", icon: "book" },
  { id: "import", label: "Nhập từ Excel", icon: "upload" },
] as const;

export default function CompetencyManagement({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("groups");
  const [revision, setRevision] = useState(0);
  const [cohort, setCohort] = useState("");
  const [selection, setSelection] = useState<CurriculumRevision | null>(null);
  const [importing, setImporting] = useState(false);
  const curricula = useCompetencyData<{ items: CurriculumRevision[] }>(`${COMPETENCY_API}/curricula`, revision);
  const allRevisions = curricula.data?.items ?? [];
  const cohorts = [...new Set(allRevisions.map(item => item.cohortCode))];
  const selected = selection ? curricula.data ? allRevisions.find(item => item.revisionId === selection.revisionId && item.cohortCode === cohort) ?? null : selection : null;
  const saved = () => setRevision(value => value + 1);
  const needsRevision = tab === "courses" || tab === "import";

  return <section className="cm-workspace comp-workspace">
    <div className="cm-toolbar"><div><h2>Danh mục và cấu hình năng lực</h2><p>Quản lý kỹ năng dùng chung, phạm vi đánh giá và tỷ lệ đóng góp của từng học phần.</p></div></div>
    <div className="cm-panel">
      <div className="cm-tabs comp-tabs" aria-label="Các chức năng đánh giá năng lực">
        {tabs.map(item => <button key={item.id} disabled={importing} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}><Icon name={item.icon} />{item.label}</button>)}
      </div>
      {needsRevision && <div className="comp-revision-selector cm-form">
        <div className="cm-form-grid">
          <label>Khóa tuyển sinh<select value={cohort} disabled={curricula.loading || importing} onChange={event => { setCohort(event.target.value); setSelection(null); }}><option value="">Chọn khóa</option>{cohorts.map(code => <option key={code} value={code}>{code}</option>)}</select></label>
          <label>Phiên bản chương trình đào tạo<select value={selected?.revisionId ?? ""} disabled={!cohort || curricula.loading || importing} onChange={event => setSelection(allRevisions.find(item => item.revisionId === event.target.value) ?? null)}><option value="">Chọn phiên bản cụ thể</option>{allRevisions.filter(item => item.cohortCode === cohort).map(item => <option key={item.revisionId} value={item.revisionId}>{item.name} · v{item.version} · {item.isCurrent ? "Hiện hành" : "Lịch sử"}{item.isActive ? "" : " · Khung ngừng sử dụng"}</option>)}</select></label>
        </div>
        <Status {...curricula} />
        {selected ? <p className="comp-revision-note"><strong>{selected.cohortCode} · Phiên bản {selected.version} · {selected.isCurrent ? "Hiện hành" : "Lịch sử"}</strong><span>{selected.courseCount} học phần · {selected.activeCount} cấu hình áp dụng · {selected.draftCount} bản nháp. Dữ liệu gắn với đúng phiên bản đã chọn.</span></p> : !curricula.loading && !curricula.error && <p className="comp-hint">{allRevisions.length ? "Chọn khóa và phiên bản để xem cấu hình hoặc nhập Excel." : "Chưa có chương trình đào tạo. Hãy thêm khung ở mục Chương trình đào tạo trước."}</p>}
      </div>}
    </div>
    {tab === "groups" && <CompetencyGroupsTab canManage={canManage} revision={revision} onSaved={saved} />}
    {tab === "profiles" && <CompetencySkillsTab canManage={canManage} revision={revision} onSaved={saved} />}
    {tab === "courses" && selected && <CompetencyCoursesTab key={selected.revisionId} curriculum={selected} canManage={canManage} revision={revision} onSaved={saved} />}
    {tab === "import" && selected && <CompetencyImportTab key={selected.revisionId} curriculum={selected} canManage={canManage} revision={revision} onSaved={saved} onBusyChange={setImporting} />}
  </section>;
}
