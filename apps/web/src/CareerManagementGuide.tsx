import { Icon } from "./ui-icon";

const steps = [
  { path: "/quantri/linh-vuc-nghe-nghiep", label: "Lĩnh vực nghề nghiệp" },
  { path: "/quantri/ky-nang", label: "Danh sách kỹ năng" },
  { path: "/quantri/vi-tri-nghe-nghiep", label: "Quản lý nghề nghiệp" },
];

const guidance: Record<string, string> = {
  "/quantri/linh-vuc-nghe-nghiep": "Tạo lĩnh vực để phân nhóm các vị trí. Trong Quản lý nghề nghiệp, mỗi vị trí chọn một lĩnh vực và liên kết các kỹ năng từ Danh sách kỹ năng.",
  "/quantri/ky-nang": "Chuẩn bị kho kỹ năng dùng chung cho nhiều vị trí. Vào Quản lý nghề nghiệp → Kỹ năng liên kết để gắn kỹ năng cho từng vị trí và đặt mức yêu cầu.",
  "/quantri/vi-tri-nghe-nghiep": "Khi thêm vị trí, chọn lĩnh vực đã có; sau khi lưu, dùng Kỹ năng liên kết để gắn kỹ năng từ danh mục chung. Bạn có thể dùng ngay lĩnh vực và kỹ năng đã có.",
};

export default function CareerManagementGuide({ currentPath, onNavigate }: {
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  if (!guidance[currentPath]) return null;
  return <section className="career-management-guide" aria-label="Gợi ý quản lý nghề nghiệp">
    <h2><Icon name="info" /> Gợi ý quản lý nghề nghiệp</h2>
    <nav aria-label="Các bước quản lý nghề nghiệp" className="career-guide-flow">
      {steps.map((step, index) => <span className="career-guide-step" key={step.path}>
        {index > 0 && <Icon name="arrow" className="career-guide-arrow" />}
        <a className="am-outline" href={step.path} aria-current={currentPath === step.path ? "page" : undefined} onClick={event => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onNavigate(step.path);
        }}><span className="career-guide-number" aria-hidden="true">{index + 1}</span>{step.label}</a>
      </span>)}
    </nav>
    <p>{guidance[currentPath]}</p>
  </section>;
}
