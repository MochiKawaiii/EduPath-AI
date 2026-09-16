export interface StudentCourse {
  code: string;
  name: string;
  englishName: string;
  description: string | null;
  credits: number;
  type: string;
  block: string;
  specialty: string;
  groupId: string;
  semester: number | null;
  studyYear: number | null;
  department: string;
  hours: {
    lecture: number | null;
    practice: number | null;
    project: number | null;
    internship: number | null;
  };
  notes: string;
  prerequisite: string;
  prior: string;
  scheduleNeedsReview: boolean;
  conditions: {
    kind: "prerequisite" | "prior";
    targetCodes: string[];
    reviewRequired: boolean;
  }[];
}
export interface StudentCurriculumData {
  id: string;
  version: number;
  name: string;
  major: string;
  cohortCode: string;
  admissionYear: number;
  totalCredits: number;
  groups: { id: string; label: string; credits: number | null }[];
  electives: {
    code: string;
    requiredCredits: number | null;
    courseCodes: string[];
  }[];
  courses: StudentCourse[];
}
export interface StudentCurriculumList {
  items: {
    id: string;
    version: number;
    name: string;
    major: string;
    cohortCode: string;
    totalCredits: number;
    courseCount: number;
  }[];
  profileCohort: string | null;
  suggestedId: string | null;
}
export const courseKind = (type: string) =>
  type.startsWith("TC") ? "elective" : "required";
export const courseTypeLabel = (type: string) =>
  type === "BB"
    ? "Bắt buộc"
    : type === "BBKTL"
      ? "Bắt buộc · BBKTL"
      : type.startsWith("TC")
        ? `Tự chọn · ${type}`
        : type;
export const searchableCourse = (course: StudentCourse) =>
  `${course.code} ${course.name} ${course.englishName}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
export const searchTerm = (term: string) =>
  term
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
