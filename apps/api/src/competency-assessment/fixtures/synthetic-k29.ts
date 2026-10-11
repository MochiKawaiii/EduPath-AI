// Builders for the synthetic K29 fixture (synthetic-k29.json). Course codes, names and KHĐT
// labels follow the public K29 curriculum; skills, weights, the career and every student
// record are invented. Used by the engine tests and available to other packages' tests.
import { readFileSync } from "node:fs";
import type { GraduationData } from "../../graduation/model.js";
import type { PlanData } from "../../plans/model.js";
import type { TranscriptData } from "../../student/transcript-parser.js";
import { physicalEducationGroupsFor } from "../plan-progress.js";
import { resolveGraduationStandard } from "../specialty.js";
import type {
  AssessmentInputs, CareerInput, CurriculumCourseInput, CurriculumInput, GraduationStandardInput, PlanRevisionInput, SpecialtyCode, WeightsInput,
} from "../types.js";

type CourseRow = [string, string, number, string, string, string, number | null, number | null];
type RelationRow = [string, "prerequisite" | "prior", string, string[], string[], boolean];
type SectionRow = [string, string, string, "choice" | "specialty" | "note", number];
type ItemRow = [string, string, string, number | null, string, string];
type StandardInfo = { id: string; revisionId: string; version: number; standardCode: string; classBlock: string; specialty: string; specialtyCodes: string[] };
type Fixture = {
  curriculum: { id: string; revisionId: string; version: number; name: string; admissionYear: number; courses: CourseRow[]; relations: RelationRow[] };
  plan: { id: string; revisionId: string; version: number; admissionYear: number; terms: string[]; sections: SectionRow[]; items: ItemRow[] };
  standards: {
    CNPM: StandardInfo; CNDL: StandardInfo; commonMandatory: string[];
    electiveGroups: { id: string; name: string; minimumCredits: number; codes: string[] }[];
    conditionOnly: string[]; minimumGpa: number;
  };
  weights: { revisionId: string; version: number; activeCount: number; maxConfigUpdatedAt: string; groups: [string, string][]; skills: [string, string, string, string][]; links: [string, string, number][] };
  career: { id: string; code: string; nameVi: string; nameEn: string; version: string; deleted: boolean; requirements: [string, string | null, string | null, string, boolean][] };
};

let cached: Fixture | null = null;
/** The raw fixture (parsed once; callers get a deep copy). */
export function syntheticFixture(): Fixture {
  cached ??= JSON.parse(readFileSync(new URL("./synthetic-k29.json", import.meta.url), "utf8")) as Fixture;
  return structuredClone(cached);
}

/** Skill ids of the fixture by short name, for readable tests. */
export const SKILL = {
  programming: "00000000-0000-4000-8000-0000000000b1",
  web: "00000000-0000-4000-8000-0000000000b2",
  database: "00000000-0000-4000-8000-0000000000b3",
  testing: "00000000-0000-4000-8000-0000000000b4",
  machineLearning: "00000000-0000-4000-8000-0000000000b5",
  bigData: "00000000-0000-4000-8000-0000000000b6",
  mobile: "00000000-0000-4000-8000-0000000000b7",
  physical: "00000000-0000-4000-8000-0000000000b8",
  defence: "00000000-0000-4000-8000-0000000000b9",
  itThinking: "00000000-0000-4000-8000-0000000000ba",
  teamwork: "00000000-0000-4000-8000-0000000000bb",
  presenting: "00000000-0000-4000-8000-0000000000bc",
  csharp: "00000000-0000-4000-8000-0000000000bd",
  cloud: "00000000-0000-4000-8000-0000000000be",
  docker: "00000000-0000-4000-8000-0000000000e1",
  cppCareer: "00000000-0000-4000-8000-0000000000e2",
} as const;

/** [code, credits, score10, score4, letter, result]; omitted values are null. */
export type TranscriptRow = [string, number, (number | null)?, (number | null)?, (string | null)?, (string | null)?];
export type TranscriptTerm = { year?: string | null; semester?: string | null; rows: TranscriptRow[]; summaries?: [string, string][] };

/** A native-style transcript: terms without a year form the "Điểm bảo lưu" section. */
export function syntheticTranscript(terms: TranscriptTerm[], parserVersion: TranscriptData["parserVersion"] = "vlu-native-1"): TranscriptData {
  return {
    schemaVersion: 1, parserVersion, pageCount: 1, warnings: [],
    courseCount: terms.reduce((sum, term) => sum + term.rows.length, 0),
    sections: terms.map((term, index) => ({
      id: term.year ? `${term.year}-${term.semester}` : `reserved-${index}`,
      academicYear: term.year ?? null, semester: term.year ? term.semester ?? null : null,
      label: term.year ? `Năm học ${term.year} – ${term.semester}` : "Điểm bảo lưu",
      summaries: (term.summaries ?? []).map(([label, value]) => ({ label, value })),
      courses: term.rows.map(([code, credits, score10 = null, score4 = null, letter = null, result = null], ordinal) => ({
        ordinal: ordinal + 1, code, name: "Học phần tổng hợp", credits, score10, score4, letter, result, conditional: false, sourcePage: 1,
      })),
    })),
  };
}

/**
 * A CNPM-like student up to HK243 (HK251 registered only). Covers: blank result cells
 * (native path), an F then a retake, MT after an F, PE electives, a 0-credit row and AV0
 * outside the CTĐT, "Điểm bảo lưu", and the printed "Tổng số tín chỉ tích lũy" (27).
 */
export function syntheticStudentTerms(): TranscriptTerm[] {
  return [
    { rows: [["71ENG010012", 2, null, null, "MT"]] },
    { year: "2023-2024", semester: "HK01", rows: [
      ["71ITBS10103", 3, 8.6, 3.7, "A"], ["71ITBS10203", 3, 3, 0, "F"], ["71NAD110013", 3, 7, 3, "B"], ["71ENG010000", 0, 6, 2, "C"],
    ] },
    { year: "2023-2024", semester: "HK02", rows: [["71ITBS10203", 3, 6.6, 2.5, "C+"], ["71ITSE30103", 3, 7.8, 3.3, "B+"], ["71PEKC10062", 2, 9, 4, "A"]] },
    { year: "2023-2024", semester: "HK03", rows: [["71ITIS30103", 3, 3.5, 0, "F"], ["71PETT10012", 2, 7, 3, "B"]] },
    { year: "2024-2025", semester: "HK01", rows: [["71ITSE30503", 3, 7.2, 3, "B"], ["71ITSE30603", 3, 5.6, 2, "C"], ["71ITIS30103", 3, null, null, "MT"]] },
    { year: "2024-2025", semester: "HK03", rows: [["71ITSE41003", 3, 8.8, 3.7, "A"], ["71ITAI40103", 3, 4.7, 1.5, "D+"], ["71ITIS30303", 3, 7, 3, "B"]],
      summaries: [["Tổng số tín chỉ tích lũy", "27"], ["Điểm TB tích lũy (Hệ 4)", "2,85"]] },
    { year: "2025-2026", semester: "HK01", rows: [["71ITSE41203", 3]] },
  ];
}

export function syntheticCurriculum(fixture = syntheticFixture()): CurriculumInput {
  const c = fixture.curriculum;
  return {
    id: c.id, revisionId: c.revisionId, version: c.version, name: c.name, admissionYear: c.admissionYear,
    courses: c.courses.map(([code, name, credits, type, block, specialty, semester, studyYear]): CurriculumCourseInput =>
      ({ code, name, credits, type, block, specialty, semester, studyYear })),
    relations: c.relations.map(([courseCode, kind, raw, targetCodes, unresolvedCodes, reviewRequired]) =>
      ({ courseCode, kind, raw, targetCodes, unresolvedCodes, reviewRequired })),
  };
}

export function syntheticWeights(fixture = syntheticFixture()): WeightsInput {
  const w = fixture.weights;
  return {
    revisionId: w.revisionId, version: w.version, activeCount: w.activeCount, maxConfigUpdatedAt: w.maxConfigUpdatedAt,
    groups: w.groups.map(([id, name]) => ({ id, name })),
    skills: w.skills.map(([skillId, name, groupId, scope]) => ({ skillId, name, description: "", scope, groupId })),
    links: w.links.map(([courseCode, skillId, weight]) => ({ courseCode, skillId, weight })),
  };
}

/** The CNPM/CNDL standards (K29 has no general standard and, here, no TTNT standard). */
export function syntheticStandards(fixture = syntheticFixture()): GraduationStandardInput[] {
  const s = fixture.standards;
  const credits = new Map(fixture.curriculum.courses.map((row) => [row[0], row[2]]));
  const names = new Map(fixture.curriculum.courses.map((row) => [row[0], row[1]]));
  return [s.CNPM, s.CNDL].map((info) => {
    let sourceRow = 1;
    const course = (groupId: string, code: string) => ({
      id: `c-${groupId}-${code}`, groupId, code, name: names.get(code) ?? code, credits: credits.get(code) ?? null,
      conditionOnly: s.conditionOnly.includes(code), sourceRow: sourceRow++,
    });
    const data: GraduationData = {
      schemaVersion: 1, name: `Tiêu chuẩn tốt nghiệp ${info.specialty}`, standardCode: info.standardCode, cohortCode: "K29",
      classBlock: info.classBlock, major: "Công nghệ thông tin", specialty: info.specialty, educationSystem: "Đại học chính quy",
      faculty: "Công nghệ Thông tin", minimumCredits: 126, mandatoryCredits: 111, electiveCredits: 15, freeElectiveCredits: null,
      minimumGpa: s.minimumGpa, gpaScale: null, notes: "",
      groups: [
        { id: "row-10", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: null, sourceRow: 10 },
        ...s.electiveGroups.map((group, index) => ({ id: group.id, name: group.name, kind: "elective" as const, minimumCredits: group.minimumCredits, sourceRow: 60 + index })),
      ],
      courses: [
        ...[...s.commonMandatory, ...info.specialtyCodes].map((code) => course("row-10", code)),
        ...s.electiveGroups.flatMap((group) => group.codes.map((code) => course(group.id, code))),
      ],
      sourceWorkbook: "synthetic.xlsx", sourceSheet: "TN", sourceNotes: [],
    };
    return { id: info.id, revisionId: info.revisionId, version: info.version, data };
  });
}

export function syntheticPlan(fixture = syntheticFixture()): PlanRevisionInput {
  const p = fixture.plan;
  const terms = p.terms.map((code) => ({ code, semester: Number(code.slice(4)), studyYear: Number(code.slice(2, 4)) - (p.admissionYear % 100) + 1, sourceCredits: null }));
  const studyYear = (termCode: string) => terms.find((term) => term.code === termCode)?.studyYear ?? 1;
  const data: PlanData = {
    schemaVersion: 1, name: "Kế hoạch đào tạo K29", major: "Công nghệ thông tin", cohortCode: "K29", admissionYear: p.admissionYear,
    totalCredits: null, notes: "",
    items: p.items.map(([termCode, code, name, credits, type, sectionId], index) => ({
      id: `row-${index + 1}`, position: index + 1, code, name, credits, type, termCode, semester: Number(termCode.slice(4)),
      studyYear: studyYear(termCode), sectionId, prerequisite: "", prior: "", notes: "",
      hours: { lecture: null, practice: null, project: null, internship: null }, sourceRow: index + 10, sourceSheet: "KHĐT", sourceCells: {},
    })),
    terms,
    sections: p.sections.map(([id, termCode, label, kind, sourceRow]) => ({ id, termCode, label, kind, sourceRow })),
    sourceWarnings: [], warnings: [], curriculum: null,
  };
  return { id: p.id, revisionId: p.revisionId, version: p.version, data, physicalEducationGroups: physicalEducationGroupsFor(syntheticCurriculum(fixture).courses) };
}

export function syntheticCareer(fixture = syntheticFixture()): CareerInput {
  const c = fixture.career;
  return {
    id: c.id, code: c.code, nameVi: c.nameVi, nameEn: c.nameEn, version: c.version, deleted: c.deleted,
    requirements: c.requirements.map(([id, skillId, skillName, title, isRequired]) => ({ id, skillId, skillName, title, isRequired })),
  };
}

export type SyntheticOptions = {
  specialty?: SpecialtyCode | null;
  terms?: TranscriptTerm[];
  transcript?: TranscriptData;
  career?: CareerInput | null;
  plan?: boolean;
};

/** Complete engine inputs for one synthetic student (default: CNPM, the student above, the synthetic career). */
export function syntheticInputs(options: SyntheticOptions = {}): AssessmentInputs {
  const fixture = syntheticFixture();
  const specialty = options.specialty === undefined ? "CNPM" : options.specialty;
  const graduation = resolveGraduationStandard(syntheticStandards(fixture), specialty, (item) => item.data);
  return {
    student: { cohortCode: "K29", specialty, careerPositionId: fixture.career.id },
    transcript: { version: "00000000-0000-4000-8000-0000000000f1", data: options.transcript ?? syntheticTranscript(options.terms ?? syntheticStudentTerms()) },
    curriculum: syntheticCurriculum(fixture),
    weights: syntheticWeights(fixture),
    graduation,
    plan: options.plan === false ? { resolution: "not_found", revision: null } : { resolution: "found", revision: syntheticPlan(fixture) },
    career: options.career === undefined ? syntheticCareer(fixture) : options.career,
    promptVersion: "comp-v1",
  };
}
