import { useEffect, useState } from "react";
import { advanceImportProgress, type ImportStage } from "./transcript-progress";

type Props = { stage: ImportStage; workerOnline?: boolean };

export default function TranscriptProgress({ stage, workerOnline = true }: Props) {
  const [progress, setProgress] = useState(() => advanceImportProgress(0, stage, workerOnline));
  useEffect(() => {
    setProgress(current => advanceImportProgress(current, stage, workerOnline));
    if (stage === "completed" || (stage !== "uploading" && !workerOnline)) return;
    const timer = setInterval(() => setProgress(current => advanceImportProgress(current, stage, workerOnline)), 1000);
    return () => clearInterval(timer);
  }, [stage, workerOnline]);
  const completed = stage === "completed";
  const percent = completed ? 100 : Math.floor(progress);
  const waiting = !completed && stage !== "uploading" && !workerOnline;
  const label = completed ? "Đã đọc và lưu bảng điểm thành công."
    : stage === "uploading"
    ? "Đang gửi PDF và chờ hệ thống đọc dữ liệu…"
    : waiting ? "Đang chờ máy xử lý kết nối lại…"
    : stage === "queued" ? "PDF đã tải lên · Đang chờ đọc dữ liệu…"
    : "Đang đọc và phân tích bảng điểm…";
  return <div className="sr-import-progress">
    <div className="sr-progress-heading"><p role="status">{label}</p><span className="sr-progress-percent">{percent}%</span></div>
    <div className={`sr-progress-track${waiting ? " is-waiting" : ""}${completed ? " is-completed" : ""}`}
      role="progressbar" aria-label="Tiến trình import bảng điểm"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      aria-valuetext={`${percent}% · ${label}`}>
      <span style={{ width: `${percent}%` }} />
    </div>
  </div>;
}
