import { z } from "zod";
export class CurriculumError extends Error {
  constructor(
    public code: string,
    public status = 422,
    public details: string[] = [],
  ) {
    super(code);
  }
}
const short = z.string().trim().max(500),
  text = z.string().trim().max(12000);
export const courseSchema = z.object({
  position: z.number().int().min(1).max(2000),
  code: z
    .string()
    .trim()
    .regex(/^\d{2}[A-Z]{2,12}\d{4,10}$/),
  name: short.min(1),
  englishName: short,
  description: text.optional(),
  credits: z.number().min(0).max(30),
  type: short.regex(/^(BB(?:KTL)?|TC\d*(?:\s*\(.*\))?)$/),
  block: short,
  specialty: short,
  semester: z.number().int().min(1).max(3).nullable(),
  studyYear: z.number().int().min(1).max(10).nullable(),
  prerequisite: text,
  prior: text,
  notes: text,
  department: short,
  departmentCode: short,
  hours: z.object({
    lecture: z.number().min(0).max(1000).nullable(),
    practice: z.number().min(0).max(1000).nullable(),
    project: z.number().min(0).max(1000).nullable(),
    internship: z.number().min(0).max(1000).nullable(),
  }),
  groupId: z.string(),
  sourceRow: z.number().int(),
  sourceSheet: z.string(),
  sourceCells: z.record(z.string(), z.string()),
});
export type CurriculumCourse = z.infer<typeof courseSchema>;
export type Relation = {
  courseCode: string;
  kind: "prerequisite" | "prior";
  raw: string;
  targetCodes: string[];
  unresolvedCodes: string[];
  reviewRequired: boolean;
};
export type CurriculumData = {
  schemaVersion: 1;
  name: string;
  major: string;
  cohortCode: string;
  admissionYear: number;
  totalCredits: number;
  notes: string;
  courses: CurriculumCourse[];
  groups: {
    id: string;
    label: string;
    credits: number | null;
    sourceRow: number;
  }[];
  electives: {
    code: string;
    requiredCredits: number | null;
    courseCodes: string[];
  }[];
  relations: Relation[];
  warnings: { row: number | null; message: string }[];
  sourceWarnings: { row: number | null; message: string }[];
};
export function rebuild(data: CurriculumData): CurriculumData {
  const seen = new Set<string>();
  data.relations = [];
  data.electives = [];
  data.warnings = [...data.sourceWarnings];
  const warn = (row: number | null, message: string) =>
    data.warnings.push({ row, message });
  for (const c of data.courses) {
    if (seen.has(c.code))
      throw new CurriculumError("duplicate_course", 422, [c.code]);
    seen.add(c.code);
    if (!c.semester || !c.studyYear)
      warn(c.sourceRow, `${c.code}: chưa xác định năm/học kỳ kế hoạch.`);
    const match = c.type.match(/^(TC\d*)/);
    if (match) {
      let group = data.electives.find((g) => g.code === match[1]);
      const explicit = c.type.match(/\((\d+)\s*TC\)/i);
      if (!group) {
        group = {
          code: match[1]!,
          requiredCredits: explicit ? Number(explicit[1]) : null,
          courseCodes: [],
        };
        data.electives.push(group);
      }
      group.courseCodes.push(c.code);
      if (explicit) {
        if (
          group.requiredCredits !== null &&
          group.requiredCredits !== Number(explicit[1])
        )
          throw new CurriculumError("conflicting_elective_credits");
        group.requiredCredits = Number(explicit[1]);
      }
    }
  }
  for (const c of data.courses)
    for (const kind of ["prerequisite", "prior"] as const) {
      const raw = c[kind].trim();
      if (!raw || /^(không|khong|none|-|0)$/i.test(raw)) continue;
      const targetCodes = [
        ...new Set(raw.match(/\b\d{2}[A-Z]{2,12}\d{4,10}\b/g) ?? []),
      ];
      const unresolvedCodes = targetCodes.filter((code) => !seen.has(code));
      const conditional = /chuyên ngành|quy định|\bhoặc\b|\bor\b|\bSV\b/i.test(
        raw,
      );
      const reviewRequired =
        conditional ||
        !targetCodes.length ||
        !!unresolvedCodes.length ||
        targetCodes.includes(c.code);
      data.relations.push({
        courseCode: c.code,
        kind,
        raw,
        targetCodes,
        unresolvedCodes,
        reviewRequired,
      });
      if (reviewRequired)
        warn(
          c.sourceRow,
          `${c.code}: ${kind === "prior" ? "học trước" : "tiên quyết"} cần rà soát${unresolvedCodes.length ? " (mã ngoài khung: " + unresolvedCodes.join(", ") + ")" : "."}`,
        );
    }
  // Detect cycles without changing source relationships or inventing course equivalences.
  const graph = new Map(
    data.courses.map((c) => [
      c.code,
      data.relations
        .filter((r) => r.courseCode === c.code && !r.reviewRequired)
        .flatMap((r) => r.targetCodes),
    ]),
  );
  const active = new Set<string>(),
    done = new Set<string>();
  let cycle = false;
  const visit = (code: string) => {
    if (active.has(code)) {
      cycle = true;
      return;
    }
    if (done.has(code)) return;
    active.add(code);
    for (const next of graph.get(code) ?? []) visit(next);
    active.delete(code);
    done.add(code);
  };
  for (const code of graph.keys()) visit(code);
  if (cycle) {
    warn(
      null,
      "Quan hệ học phần có chu trình; cần rà soát trước khi lập lộ trình.",
    );
    for (const r of data.relations) r.reviewRequired = true;
  }
  for (const group of data.electives)
    if (group.requiredCredits === null)
      warn(
        null,
        `Nhóm ${group.code}: chưa có số tín chỉ phải chọn ghi rõ trong cột BB/TC; giữ nguyên quy định khối trong Excel.`,
      );
  return data;
}
