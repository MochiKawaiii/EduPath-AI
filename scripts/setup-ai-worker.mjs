// Configures the local AI worker (Ollama) without printing secrets.
// Usage: node scripts/setup-ai-worker.mjs [API_URL] [--num-gpu=N]
//   API_URL defaults to http://localhost:4000 (use the HTTPS API origin for production).
//   --num-gpu sets OLLAMA_NUM_GPU (GPU layers); without it an existing valid value is kept.
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const root = new URL("../", import.meta.url);
const apiEnvFile = new URL("apps/api/.env", root);
const workerEnvFile = new URL("services/ai/.env", root);

const args = process.argv.slice(2);
const numGpuArg = args.find((arg) => arg.startsWith("--num-gpu="))?.slice("--num-gpu=".length);
const urlArg = args.find((arg) => !arg.startsWith("--"));

const unquote = (value) => value.trim().replace(/^['"]|['"]$/g, "");
const readSetting = (text, name) => {
  const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? unquote(match[1].replace(/\r$/, "")) : undefined;
};

const apiUrl = new URL(urlArg || "http://localhost:4000");
const localApi = apiUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(apiUrl.hostname);
if (apiUrl.protocol !== "https:" && !localApi) throw new Error("API URL must use HTTPS, or http://localhost / http://127.0.0.1.");
if (apiUrl.username || apiUrl.password) throw new Error("API URL must not contain credentials.");

let apiEnv = await readFile(apiEnvFile, "utf8").catch(() => "");
const ocrKey = readSetting(apiEnv, "OCR_WORKER_KEY");
let aiKey = readSetting(apiEnv, "AI_WORKER_KEY");
let generated = false;
if (aiKey) {
  if (aiKey.length < 32) throw new Error("Existing AI_WORKER_KEY in apps/api/.env is shorter than 32 characters. Remove that line and run this script again.");
  if (ocrKey && aiKey === ocrKey) throw new Error("AI_WORKER_KEY must differ from OCR_WORKER_KEY. Remove the AI_WORKER_KEY line and run this script again.");
} else {
  do aiKey = randomBytes(32).toString("hex");
  while (aiKey === ocrKey);
  const eol = apiEnv.includes("\r\n") ? "\r\n" : "\n";
  apiEnv = apiEnv.replace(/^AI_WORKER_KEY=.*(\r?\n|$)/m, "");
  await writeFile(apiEnvFile, `${apiEnv.trimEnd()}${apiEnv.trim() ? eol : ""}AI_WORKER_KEY=${aiKey}${eol}`, "utf8");
  generated = true;
}

const previousWorkerEnv = await readFile(workerEnvFile, "utf8").catch(() => "");
let numGpu = numGpuArg ?? readSetting(previousWorkerEnv, "OLLAMA_NUM_GPU");
if (numGpu !== undefined && numGpu !== "") {
  if (!/^\d{1,3}$/.test(numGpu)) throw new Error("--num-gpu must be a whole number between 0 and 999.");
} else {
  numGpu = undefined;
}

// Rewrites the whole file with whitelisted keys only, replacing any stale experimental file.
const lines = [
  `AI_API_URL=${apiUrl.origin}`,
  `AI_WORKER_KEY=${aiKey}`,
  "OLLAMA_URL=http://127.0.0.1:11434",
  "OLLAMA_MODEL=gemma4:e4b",
  "OLLAMA_CONTEXT=16384",
  "AI_TIMEOUT_MS=600000"
];
if (numGpu !== undefined) lines.push(`OLLAMA_NUM_GPU=${numGpu}`);
await writeFile(workerEnvFile, `${lines.join("\n")}\n`, "utf8");

console.log(
  `Configured services/ai/.env${generated ? " and added AI_WORKER_KEY to apps/api/.env" : " (reused AI_WORKER_KEY from apps/api/.env)"}. ` +
    `Secrets were not printed.${generated ? " Restart the backend so it loads the new key." : ""}`
);
