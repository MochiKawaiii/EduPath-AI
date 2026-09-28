import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { identity, type PlanData } from "./model.js";
import { PlanRepository } from "./repository.js";

describe("PlanRepository.link", () => {
  it("links by normalized major and cohort using the curriculum current revision", async () => {
    const data: PlanData = {
      schemaVersion: 1,
      name: "Plan K29",
      major: " CÔNG NGHỆ THÔNG TIN ",
      cohortCode: "K29",
      admissionYear: 2023,
      totalCredits: null,
      notes: "",
      items: [],
      terms: [],
      sections: [],
      sourceWarnings: [],
      warnings: [],
      curriculum: null,
    };
    const currentRevision = {
      id: "curriculum-id",
      revisionId: "current-revision-id",
      version: 4,
      data: { name: "Curriculum K29", totalCredits: 120, courses: [] },
    };
    const query = vi.fn(async () => ({ rowCount: 1, rows: [currentRevision] }));
    const repository = new PlanRepository({ query } as unknown as DatabasePool);

    await repository.link(data);

    expect(identity(data)).toBe("cong nghe thong tin:K29");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("JOIN curriculum_revisions r ON r.id=c.current_revision"),
      [identity(data)],
    );
    expect(data.curriculum).toEqual({
      id: "curriculum-id",
      revisionId: "current-revision-id",
      version: 4,
      name: "Curriculum K29",
    });
  });
});
