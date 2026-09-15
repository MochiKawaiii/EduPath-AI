import { readFile } from "node:fs/promises";
import type { DatabasePool } from "../db/pool.js";
import { readWorkbook } from "./parser.js";
import { CurriculumRepository } from "./repository.js";

// Seed only absent identities. Never overwrite a later administrator revision or reopen a locked framework.
export async function seedCurricula(pool: DatabasePool) {
  const repository = new CurriculumRepository(pool);
  for (const [cohort, filename] of [
    ["K29", "CTĐT_CNTT_K29 (2025 Mẫu Khoa).xlsx"],
    ["K30", "CTĐT_CNTT_K30 (2025 Mẫu Khoa).xlsx"],
    ["K31", "CTĐT_CNTT_K31.xlsx"],
  ]) {
    const file = await readFile(
      new URL(`../../data/curricula/${cohort}.xlsx`, import.meta.url),
    );
    await repository.create(await readWorkbook(file), file, filename!);
  }
}
