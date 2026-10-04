import type { CurriculumCourse, CurriculumData } from "./curriculum-types";

const electiveCode = (type: string) => type.match(/^(TC\d*)/)?.[1];
const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const conditionBlock = (label: string) => /giao duc the chat|giao duc quoc phong/.test(fold(label));
const uniqueCourses = (courses: CurriculumCourse[]) => [...new Map(courses.map((course) => [course.code, course])).values()];
const sum = (courses: CurriculumCourse[]) => uniqueCourses(courses).reduce((total, course) => total + course.credits, 0);

export function curriculumCredits(data: CurriculumData) {
  const blocks = data.groups.map((group) => {
    const courses = data.courses.filter((course) => course.groupId === group.id);
    const required = sum(courses.filter((course) => /^(BB|BBKTL)$/.test(course.type)));
    const codes = [...new Set(courses.map((course) => electiveCode(course.type)).filter((code): code is string => !!code))];
    const electives = codes.map((code) => {
      const entry = data.electives.find((elective) => elective.code === code);
      // A quota shared by several blocks must not be counted once per block.
      const shared = new Set(data.courses.filter((course) => electiveCode(course.type) === code).map((course) => course.groupId)).size > 1;
      return { code, requiredCredits: shared ? null : entry?.requiredCredits ?? null };
    });
    const knownCredits = electives.reduce((total, elective) => total + (elective.requiredCredits ?? 0), 0);
    const unresolved = electives.some((elective) => elective.requiredCredits === null);
    const remaining = group.credits === null ? null : group.credits - required;
    // Source block totals can supply the combined quota, even when individual
    // elective codes have no quota. Never sum all the offered alternatives.
    const inferred = unresolved && remaining !== null && remaining > 0 && remaining >= knownCredits &&
      remaining <= sum(courses.filter((course) => !!electiveCode(course.type))) &&
      !courses.some((course) => !/^(BB|BBKTL)$/.test(course.type) && !electiveCode(course.type)) &&
      !codes.some((code) => new Set(data.courses.filter((course) => electiveCode(course.type) === code).map((course) => course.groupId)).size > 1);
    return {
      id: group.id,
      label: group.label,
      totalCredits: group.credits,
      requiredCredits: required,
      electiveCredits: unresolved ? inferred ? remaining : null : knownCredits,
      electives,
      fromBlockTotal: !!inferred,
      conditionOnly: conditionBlock(group.label) || (courses.some((course) => course.type === "BBKTL") && courses.every((course) => course.type !== "BB")),
      courseCount: courses.length,
    };
  });
  const conditionIds = new Set(blocks.filter((block) => block.conditionOnly).map((block) => block.id));
  const accumulated = data.courses.filter((course) => course.type !== "BBKTL" && !conditionIds.has(course.groupId) && !conditionBlock(course.block));
  const requiredCourses = accumulated.filter((course) => course.type === "BB");
  const common = requiredCourses.filter((course) => !course.specialty.trim());
  const commonCodes = new Set(common.map((course) => course.code));
  const specialties = [...new Set(requiredCourses.map((course) => course.specialty.trim()).filter(Boolean))];
  const specialtyCredits = specialties.map((specialty) => sum(requiredCourses.filter((course) => course.specialty.trim() === specialty && !commonCodes.has(course.code))));
  const ambiguousCourses = accumulated.some((course) => !course.type || (!electiveCode(course.type) && course.type !== "BB")) ||
    accumulated.some((course) => accumulated.some((other) => other.code === course.code && (other.type !== course.type || other.credits !== course.credits)));
  const sameSpecialtyCredits = specialtyCredits.every((credits) => credits === specialtyCredits[0]);
  const requiredCredits = ambiguousCourses || !sameSpecialtyCredits ? null : sum(common) + (specialtyCredits[0] ?? 0);
  const remainder = requiredCredits === null ? null : data.totalCredits - requiredCredits;
  const electiveBlocks = blocks.filter((block) => !block.conditionOnly && block.electives.length);
  const knownElectiveCredits = electiveBlocks.reduce((total, block) => total + (block.electiveCredits ?? 0), 0);
  const allQuotasKnown = electiveBlocks.every((block) => block.electiveCredits !== null);
  const electiveCredits = remainder === null || remainder < 0 || knownElectiveCredits > remainder ||
    (allQuotasKnown && knownElectiveCredits !== remainder) ||
    (remainder > 0 && !accumulated.some((course) => electiveCode(course.type))) ? null : remainder;
  return {
    requiredCredits,
    electiveCredits,
    blocks,
    hasSpecialties: specialties.length > 0,
    hasConditionCredits: conditionIds.size > 0 || data.courses.some((course) => course.type === "BBKTL"),
  };
}

export const creditLabel = (credits: number | null) => credits === null ? "Chưa xác định" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(credits);
