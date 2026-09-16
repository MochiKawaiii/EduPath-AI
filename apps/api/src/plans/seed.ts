import { readFile } from "node:fs/promises";
import type { DatabasePool } from "../db/pool.js";
import { readWorkbook } from "./parser.js";
import { PlanRepository } from "./repository.js";
export async function seedPlans(pool: DatabasePool) {
  const repository = new PlanRepository(pool);
  for (const cohort of ["K29", "K30", "K31"]) {
    const file = await readFile(
      new URL(`../../data/plans/${cohort}.xlsx`, import.meta.url),
    );
    const data = await repository.link(await readWorkbook(file));
    await repository.create(
      data,
      file,
      `Ke hoach giảng dạy CNTT ${cohort}.xlsx`,
    );
  }
}
