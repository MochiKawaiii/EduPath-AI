export interface GraduationData {
  schemaVersion: 1;
  name: string;
  standardCode: string;
  cohortCode: string;
  classBlock: string;
  major: string;
  specialty: string;
  educationSystem: string;
  faculty: string;
  minimumCredits: number | null;
  mandatoryCredits: number | null;
  electiveCredits: number | null;
  freeElectiveCredits: number | null;
  minimumGpa: number | null;
  notes: string;
  groups: {
    id: string;
    name: string;
    kind: "mandatory" | "elective";
    minimumCredits: number | null;
    sourceRow: number;
  }[];
  courses: {
    id: string;
    groupId: string;
    code: string;
    name: string;
    credits: number | null;
    conditionOnly: boolean;
    sourceRow: number;
  }[];
  sourceWorkbook: string;
  sourceSheet: string;
  sourceNotes: string[];
}
export interface GraduationDetail {
  id: string;
  token: string;
  isActive: boolean;
  revisionId: string;
  version: number;
  sourceFilename: string;
  data: GraduationData;
  warnings: string[];
  history: { id: string; version: number; note: string; createdAt: string }[];
  events: { action: string; createdAt: string }[];
}
export interface GraduationList {
  items: {
    id: string;
    name: string;
    major: string;
    specialty: string;
    cohortCode: string;
    classBlock: string;
    isActive: boolean;
    version: number;
    minimumCredits: number | null;
  }[];
}
export interface GraduationPreview {
  fingerprint: string;
  items: {
    index: number;
    key: string;
    data: GraduationData;
    warnings: string[];
    existingId: string | null;
  }[];
}
