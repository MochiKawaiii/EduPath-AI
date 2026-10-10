import { parentPort, workerData } from "node:worker_threads";
try {
  const module = workerData.moduleUrl.endsWith('.ts')
    ? await (await import('tsx/esm/api')).tsImport(workerData.moduleUrl, import.meta.url)
    : await import(workerData.moduleUrl);
  parentPort.postMessage({ data: await module.readCompetencyWorkbook(Buffer.from(workerData.buffer)) });
} catch (error) {
  parentPort.postMessage({ error: error.code ?? 'invalid_workbook', status: error.status ?? 422, details: error.details ?? [] });
}
