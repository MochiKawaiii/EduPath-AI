export type ImportStage = "uploading" | "queued" | "processing" | "completed";

export function advanceImportProgress(current: number, stage: ImportStage, workerOnline = true): number {
  if (stage === "completed") return 100;
  const minimum = stage === "uploading" ? 2 : stage === "queued" ? 20 : 30;
  const maximum = stage === "uploading" ? 18 : stage === "queued" ? 28 : 95;
  const progress = Math.max(current, minimum);
  if ((stage !== "uploading" && !workerOnline) || progress >= maximum) return progress;
  return Math.min(maximum, progress + Math.max(0.15, (maximum - progress) * 0.025));
}
