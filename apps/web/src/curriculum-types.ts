export interface CurriculumCourse {
  position: number;
  code: string;
  name: string;
  englishName: string;
  description?: string;
  credits: number;
  type: string;
  block: string;
  specialty: string;
  semester: number | null;
  studyYear: number | null;
  prerequisite: string;
  prior: string;
  notes: string;
  department: string;
  departmentCode: string;
  hours: {
    lecture: number | null;
    practice: number | null;
    project: number | null;
    internship: number | null;
  };
  groupId: string;
  sourceRow: number;
  sourceSheet: string;
  sourceCells: Record<string, string>;
}
export interface CurriculumData {
  schemaVersion: 1;
  name: string;
  major: string;
  cohortCode: string;
  admissionYear: number;
  totalCredits: number;
  notes: string;
  courses: CurriculumCourse[];
  groups: {
    isHeading?: boolean;
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
  relations: {
    courseCode: string;
    kind: "prerequisite" | "prior";
    raw: string;
    targetCodes: string[];
    unresolvedCodes: string[];
    reviewRequired: boolean;
  }[];
  warnings: { row: number | null; message: string }[];
  sourceWarnings: { row: number | null; message: string }[];
}
export interface CurriculumDetail {
  id: string;
  token: string;
  isActive: boolean;
  version: number;
  revisionId: string;
  sourceFilename: string;
  updatedAt: string;
  data: CurriculumData;
  history: { id: string; version: number; note: string; createdAt: string }[];
  events: { action: string; createdAt: string }[];
}
export interface CurriculumList {
  items: {
    id: string;
    name: string;
    major: string;
    cohortCode: string;
    isActive: boolean;
    version: number;
    totalCredits: number;
    courseCount: number;
    warningCount: number;
    updatedAt: string;
  }[];
  total: number;
  cohorts: string[];
}
