import { useEffect, useState } from "react";
import { Status, useData } from "./admin-ui";
import { Icon } from "./admin-account-shared";
import type { Career } from "./career-types";
import CareerRequirementsManagement from "./CareerRequirementsManagement";

export default function CareerLinksManagement({ canManage, revision, saved, close }: {
  canManage: boolean; revision: number; saved: () => void; close: () => void;
}) {
  const remote = useData<{ items: Career[] }>("/api/admin/careers", revision);
  const [lastCareers, setLastCareers] = useState<Career[]>([]);
  const [careerId, setCareerId] = useState("");
  const careers = remote.data?.items ?? lastCareers;
  const career = careers.find(item => item.id === careerId);
  useEffect(() => {
    if (remote.data) {
      setLastCareers(remote.data.items);
      if (careerId && !remote.data.items.some(item => item.id === careerId)) setCareerId("");
    }
  }, [remote.data, careerId]);
  return <>
    <div><button className="am-outline" onClick={close}><Icon name="back" /> Danh sách vị trí</button></div>
    <section className="cm-panel career-detail-panel cm-form">
      <div><h2>Kỹ năng liên kết</h2><p>Chọn vị trí nghề nghiệp để thêm, cập nhật hoặc gỡ liên kết kỹ năng và quản lý yêu cầu.</p></div>
      <Status {...remote} />
      <label>Vị trí nghề nghiệp<select value={careerId} disabled={!careers.length} onChange={event => setCareerId(event.target.value)}>
        <option value="">Chọn vị trí nghề nghiệp</option>
        {careers.map(item => <option key={item.id} value={item.id}>{item.nameVi} — {item.nameEn}</option>)}
      </select></label>
      {remote.data && !careers.length && <p>Thêm vị trí nghề nghiệp trước khi liên kết kỹ năng.</p>}
    </section>
    {career && !remote.error && <CareerRequirementsManagement key={career.id} canManage={canManage} career={career} revision={revision} saved={saved} />}
  </>;
}
