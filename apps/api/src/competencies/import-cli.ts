import "dotenv/config";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { createDatabasePool } from "../db/pool.js";
import { canAccessAdmin, type AuthenticatedUser } from "../auth/types.js";
import { parseCompetencyWorkbook } from "./workbook.js";
import { applyCompetencyImport, previewCompetencyImport } from "./import.js";
import { CompetencyError } from "./model.js";

// Preview is the default. Applying always requires an operator-supplied preview
// token, so a file cannot overwrite a changed configuration without fresh review.
const flags = new Set(["--apply", "--confirm-warnings", "--confirm-overwrite", "--help"]);
const options: Record<string, string | boolean> = {};
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index]!;
  if (flags.has(key)) options[key] = true;
  else if (["--file", "--cohort", "--revision", "--actor", "--token"].includes(key) && process.argv[index + 1] && !process.argv[index + 1]!.startsWith("--")) options[key] = process.argv[++index]!;
  else throw new Error(`Unknown or incomplete argument: ${key}`);
}
if (options["--help"]) {
  console.log("Preview: npm run db:import-competencies -- --file <xlsx> --cohort K29 --revision <uuid>");
  console.log("Apply: add --apply --actor <existing-admin-uuid> --token <preview-token> [--confirm-warnings] [--confirm-overwrite]");
} else {
  const input = z.object({
    file:z.string().min(1),cohort:z.string().regex(/^K\d+$/),revision:z.uuid(),
    actor:z.uuid().optional(),token:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).parse({file:options["--file"],cohort:options["--cohort"],revision:options["--revision"],actor:options["--actor"],token:options["--token"]});
  if (!/\.xlsx$/i.test(input.file) || (await stat(input.file)).size > 5 * 1024 * 1024) throw new Error("File must be XLSX and no larger than 5 MiB");
  const buffer=await readFile(input.file),filename=basename(input.file);
  if(filename.length>240) throw new Error("File name must be at most 240 characters");
  const data=await parseCompetencyWorkbook(buffer);
  const pool=createDatabasePool(loadConfig().database);
  try {
    const source={revisionId:input.revision,cohortCode:input.cohort,filename,buffer};
    if(!options["--apply"]) console.log(JSON.stringify(await previewCompetencyImport(pool,data,source),null,2));
    else {
      if(!input.actor||!input.token) throw new Error("Apply requires --actor and --token from a reviewed preview");
      const row=(await pool.query(`SELECT id,entra_tenant_id,entra_object_id,display_name,email,username,COALESCE(role_override,role) AS role
        FROM users WHERE id=$1 AND is_active`,[input.actor])).rows[0];
      if(!row||!canAccessAdmin(row.role)) throw new CompetencyError("insufficient_role",403);
      const actor:AuthenticatedUser={userId:row.id,identityKey:`${row.entra_tenant_id}:${row.entra_object_id}`,tenantId:row.entra_tenant_id,objectId:row.entra_object_id,name:row.display_name,email:row.email,username:row.username,role:row.role,signedInAt:new Date().toISOString()};
      console.log(JSON.stringify(await applyCompetencyImport(pool,data,{...source,token:input.token,confirmWarnings:options["--confirm-warnings"]===true,confirmOverwrite:options["--confirm-overwrite"]===true},actor),null,2));
    }
  } catch(error) {
    if(error instanceof CompetencyError) console.error(JSON.stringify({error:error.code,details:error.details}));
    else console.error("Import failed; transaction rolled back. No connection settings were logged.");
    process.exitCode=1;
  } finally {await pool.end();}
}
