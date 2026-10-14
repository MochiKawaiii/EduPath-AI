// The graduation thesis option of an elective group: K29 "Nhóm tự chọn TC306" (6 TC) holds
// 71ITGR40206 Đồ án Tốt nghiệp (6 TC) next to 3-TC replacement courses ("Khóa luận/đồ án tốt
// nghiệp; hoặc học phần thay thế KL/ĐA TN"), K28 the same with Khóa luận tốt nghiệp. Pure. The
// graduation page's deterministic suggestions (apps/web) apply the same rule: keep both identical.
// The Khoa's eligibility rule for doing the thesis is not in our data.
import type { GradCourseState, GraduationCourseRow, GraduationGroupEvaluation } from "./evaluation.js";
import { fold } from "./model.js";

/**
 * not_started: neither the thesis nor a replacement course is under way; replacement: another
 * course of the group is passed, exempt, in progress or graded (the student took the replacement
 * path); thesis_in_progress: the thesis course itself is in progress.
 */
export type ThesisPath = "not_started" | "replacement" | "thesis_in_progress";

export type ThesisOption = {
  /** The first course of the group, in standard order, that is a thesis and completes the group alone. */
  thesis: GraduationCourseRow;
  /** Every other course of the group, in standard order. */
  replacements: GraduationCourseRow[];
  path: ThesisPath;
};

/** Matched on the folded name (NFD, marks stripped, đ → d, lower case, spaces collapsed). */
export const THESIS_NAME_PATTERN = /\b(do an|khoa luan) tot nghiep\b/;

/** A course state that puts the student on the replacement path (a failed attempt does not). */
export const startsReplacementPath = (state: GradCourseState): boolean =>
  state === "passed" || state === "exempt" || state === "in_progress" || state === "graded_unknown";

const isThesis = (course: GraduationCourseRow, required: number | null): boolean =>
  course.credits !== null && required !== null && course.credits >= required && THESIS_NAME_PATTERN.test(fold(course.name));

/** The thesis option of an elective group that is not passed; null for any other group or without a thesis course. */
export function thesisOption(group: GraduationGroupEvaluation): ThesisOption | null {
  if (group.kind !== "elective" || group.status === "pass") return null;
  const thesis = group.courses.find((course) => isThesis(course, group.required));
  if (!thesis) return null;
  const replacements = group.courses.filter((course) => course !== thesis);
  const path: ThesisPath = thesis.state === "in_progress" ? "thesis_in_progress"
    : replacements.some((course) => startsReplacementPath(course.state)) ? "replacement" : "not_started";
  return { thesis, replacements, path };
}

/** "khóa luận tốt nghiệp" or "đồ án tốt nghiệp", as the thesis course names itself. */
export const thesisNoun = (thesis: Pick<GraduationCourseRow, "name">): string =>
  THESIS_NAME_PATTERN.exec(fold(thesis.name))?.[1] === "khoa luan" ? "khóa luận tốt nghiệp" : "đồ án tốt nghiệp";
