import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const demoFile = resolve(projectRoot, "..", "tk_demo");
const exampleFile = resolve(projectRoot, "apps", "api", ".env.example");
const outputFile = resolve(projectRoot, "apps", "api", ".env");

function extract(source, pattern, label) {
  const match = source.match(pattern);
  if (!match?.[1]) throw new Error(`Missing ${label} in tk_demo`);
  return match[1].trim().replace(/^(["'])(.*)\1$/, "$2");
}

function replaceEnvironmentValue(source, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (!pattern.test(source)) throw new Error(`Missing ${key} in .env.example`);
  return source.replace(pattern, `${key}=${value}`);
}

let outputExists = true;
try {
  await access(outputFile, constants.F_OK);
} catch {
  outputExists = false;
}
if (outputExists) {
  throw new Error("apps/api/.env already exists; refusing to overwrite it");
}

const source = await readFile(demoFile, "utf8");
const clientId = extract(
  source,
  /^\s*Application \(client\) ID\s*[:=]\s*(.+?)\s*$/im,
  "Application (client) ID"
);
const tenantId = extract(
  source,
  /^\s*Directory \(tenant\) ID\s*[:=]\s*(.+?)\s*$/im,
  "Directory (tenant) ID"
);
const clientSecret = extract(source, /^\s*Value\s*[:=]\s*(.+?)\s*$/im, "Value");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!uuidPattern.test(clientId)) throw new Error("Application (client) ID is not a valid UUID");
if (!uuidPattern.test(tenantId)) throw new Error("Directory (tenant) ID is not a valid UUID");
if (clientSecret.length < 8) throw new Error("Client Secret Value appears to be invalid");

let environment = await readFile(exampleFile, "utf8");
environment = replaceEnvironmentValue(environment, "ENTRA_CLIENT_ID", clientId);
environment = replaceEnvironmentValue(environment, "ENTRA_TENANT_ID", tenantId);
environment = replaceEnvironmentValue(
  environment,
  "ENTRA_CLIENT_SECRET",
  JSON.stringify(clientSecret)
);
environment = replaceEnvironmentValue(
  environment,
  "SESSION_SECRET",
  randomBytes(48).toString("base64url")
);

await writeFile(outputFile, environment, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx"
});

console.log("Created apps/api/.env with validated Entra IDs and a generated session secret.");
console.log("Demo usernames and passwords were not copied.");
