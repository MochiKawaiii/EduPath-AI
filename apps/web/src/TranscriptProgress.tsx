type Props = { stage: "uploading" | "queued" | "processing"; workerOnline?: boolean };

export default function TranscriptProgress({ stage, workerOnline = true }: Props) {
  const waiting = stage !== "uploading" && !workerOnline;
  const label = stage === "uploading"
    ? "Đang gửi PDF và chờ hệ thống đọc dữ liệu…"
    : waiting ? "Đang chờ máy xử lý kết nối lại…"
    : stage === "queued" ? "PDF đã tải lên · Đang chờ đọc dữ liệu…"
    : "Đang đọc và phân tích bảng điểm…";
  return <div className="sr-import-progress">
    <p role="status">{label}</p>
    <div className={`sr-progress-track${waiting ? " is-waiting" : ""}`}
      role="progressbar" aria-label="Tiến trình import bảng điểm" aria-valuetext={label}>
      <span />
    </div>
  </div>;
}
