import type { PlanData } from "../plans/model.js";
import { courseKey, electiveCodeOf } from "./course-state.js";
import type { ElectiveQuota } from "./graduation.js";
import { fold } from "./specialty.js";
import type { CourseState, LateEntry, NextEntry, PlanCourseRef, PlanProgressResult } from "./types.js";

type PlanItem = PlanData["items"][number];
type PlanSection = PlanData["sections"][number];

/** What progress needs to know about one curriculum course. */
export type PlanCourseInfo = {
  code: string;
  name: string;
  credits: number;
  state: CourseState;
  /** In the applicable set A (common, own specialty, or already attempted). */
  applicable: boolean;
  electiveCode: string | null;
};

/** Same object plans/student-router.ts returns: PE elective codes per group (TC002, TC102). */
export function physicalEducationGroupsFor(courses: readonly { code: string; type: string }[]): Record<string, string[]> {
  return Object.fromEntries(["TC002", "TC102"].map((group) => [group,
    [...new Set(courses.filter((course) => electiveCodeOf(course.type) === group).map((course) => courseKey(course.code)))]]));
}

/** "GDTC 1", "GDTC2", "Giáo dục thể chất 1" → slot number (port of student-plan-results.ts). */
export function physicalEducationSlot(name: string): number | null {
  const folded = name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  const slot = /^(?:GDTC|GIAO DUC THE CHAT)\s*([12])$/.exec(folded);
  return slot ? Number(slot[1]) : null;
}

export type ChoiceRule = {
  /** k in "Chọn k trong n", or null. */
  k: number | null;
  /** n in "trong n", or null. */
  stated: number | null;
  /** A choice-like section that is never late: no k, or "(Không tính vào tích lũy)". */
  informational: boolean;
  /** The label describes a choice at all ("Chọn …"). */
  choice: boolean;
};

/** Reads k from the folded label with /ch[oọ]n\s*(\d+)/ ("Chọn1 trong 3", "Chọn 2 trong 4 HP tự chọn Chuyên ngành"). */
export function choiceRule(label: string): ChoiceRule {
  const folded = fold(label);
  const k = /ch[oọ]n\s*(\d+)/i.exec(folded)?.[1];
  const stated = /trong\s*(\d+)/i.exec(folded)?.[1];
  const choice = /(?:^|[^a-z])chon/.test(folded);
  return {
    k: k ? Number(k) : null,
    stated: stated ? Number(stated) : null,
    choice,
    informational: choice && (!k || Number(k) < 1 || folded.includes("khong tinh vao tich luy")),
  };
}

const done = (state: CourseState) => state === "passed" || state === "exempt";
/** Registered, or graded with an unreadable result: never reported as late. */
const ongoing = (state: CourseState) => state === "in_progress" || state === "graded_unknown";
const ref = (course: PlanCourseInfo): PlanCourseRef => ({ code: course.code, name: course.name, credits: course.credits, state: course.state });
const minCredits = (courses: readonly PlanCourseInfo[]) => courses.length ? Math.min(...courses.map((course) => course.credits)) : 0;
const maxCredits = (courses: readonly PlanCourseInfo[]) => courses.length ? Math.max(...courses.map((course) => course.credits)) : 0;

type ChoiceSlot = {
  section: PlanSection;
  need: number;
  options: PlanCourseInfo[];
  electiveCodes: Set<string>;
  done: number;
  ongoing: number;
};

type QuotaGroup = {
  code: string;
  quota: number | null;
  items: { course: PlanCourseInfo; termCode: string }[];
  dueTerm: string;
  doneCredits: number;
  ongoingCredits: number;
};

/**
 * Progress against the training plan (spec §7.8):
 * - current term = latest graded term; an item is due when its term ≤ current term;
 * - GDTC slots (DGT0010/DGT0020, "GDTC1") count passed PE electives;
 * - "Chọn k …" sections need k courses; sections without k or "(Không tính vào tích lũy)" are never late;
 * - each passed course is allocated to one choice section only, earliest first, then same-group substitutes;
 * - elective items outside choice sections (TC406) form one quota choice in credits;
 * - applicability comes from the curriculum (PlanCourseInfo.applicable), never from section labels;
 * - in-progress (and graded with an unknown result) is never late; items outside the curriculum are skipped except GDTC slots.
 */
export function planProgress(args: {
  plan: Pick<PlanData, "items" | "sections" | "terms">;
  physicalEducationGroups: Record<string, string[]>;
  currentTerm: string | null;
  courses: ReadonlyMap<string, PlanCourseInfo>;
  quotas: ReadonlyMap<string, ElectiveQuota>;
}): PlanProgressResult {
  const { currentTerm, courses } = args;
  const due = (term: string) => currentTerm !== null && term <= currentTerm;
  const items = [...args.plan.items].sort((a, b) => (a.termCode < b.termCode ? -1 : a.termCode > b.termCode ? 1 : a.position - b.position));
  const sections = [...args.plan.sections].sort((a, b) =>
    a.termCode < b.termCode ? -1 : a.termCode > b.termCode ? 1 : a.sourceRow - b.sourceRow || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const rules = new Map(sections.map((section) => [section.id, choiceRule(section.label)]));

  const countMismatches: PlanProgressResult["countMismatches"] = [];
  for (const section of sections) {
    const stated = rules.get(section.id)!.stated;
    const actual = items.filter((item) => item.sectionId === section.id).length;
    if (stated !== null && stated !== actual) countMismatches.push({ label: section.label, termCode: section.termCode, stated, actual });
  }

  const slots: { item: PlanItem; number: number }[] = [];
  const plain = new Map<string, { course: PlanCourseInfo; termCode: string }>();
  const choiceSlots: ChoiceSlot[] = [];
  const informational = new Map<string, { label: string; termCode: string; options: PlanCourseInfo[] }>();
  const quotaGroups = new Map<string, QuotaGroup>();
  const slotBySection = new Map<string, ChoiceSlot>();

  for (const item of items) {
    const number = physicalEducationSlot(item.name);
    if (number !== null) { slots.push({ item, number }); continue; }
    const course = courses.get(courseKey(item.code));
    if (!course || !course.applicable) continue; // Not in the curriculum, or another specialty's course.
    const section = item.sectionId ? sectionById.get(item.sectionId) : undefined;
    const rule = section ? rules.get(section.id)! : null;
    if (section && rule?.choice && rule.informational) {
      const entry = informational.get(section.id) ?? { label: section.label, termCode: section.termCode, options: [] };
      if (!entry.options.some((option) => option.code === course.code)) entry.options.push(course);
      informational.set(section.id, entry);
    } else if (section && rule?.choice && rule.k !== null) {
      let slot = slotBySection.get(section.id);
      if (!slot) { slot = { section, need: rule.k, options: [], electiveCodes: new Set(), done: 0, ongoing: 0 }; slotBySection.set(section.id, slot); choiceSlots.push(slot); }
      if (!slot.options.some((option) => option.code === course.code)) slot.options.push(course);
      if (course.electiveCode) slot.electiveCodes.add(course.electiveCode);
    } else if (course.electiveCode) {
      const quota = args.quotas.get(course.electiveCode)?.quota ?? null;
      const group = quotaGroups.get(course.electiveCode) ?? { code: course.electiveCode, quota, items: [], dueTerm: item.termCode, doneCredits: 0, ongoingCredits: 0 };
      if (!group.items.some((entry) => entry.course.code === course.code)) group.items.push({ course, termCode: item.termCode });
      if (item.termCode > group.dueTerm) group.dueTerm = item.termCode;
      quotaGroups.set(course.electiveCode, group);
    } else if (!plain.has(course.code)) {
      plain.set(course.code, { course, termCode: item.termCode });
    }
  }
  for (const slot of choiceSlots) slot.need = Math.min(slot.need, Math.max(slot.options.length, 1));

  // One allocation per course: own options first (passed, then in progress), then substitutes
  // from the same CTĐT elective group, earliest section first.
  const allocated = new Set<string>();
  const allocate = (slot: ChoiceSlot, candidates: readonly PlanCourseInfo[], accept: (state: CourseState) => boolean, field: "done" | "ongoing") => {
    for (const course of candidates) {
      if (slot.done + slot.ongoing >= slot.need) return;
      if (allocated.has(course.code) || !accept(course.state)) continue;
      allocated.add(course.code);
      slot[field]++;
    }
  };
  for (const slot of choiceSlots) allocate(slot, slot.options, done, "done");
  for (const slot of choiceSlots) allocate(slot, slot.options, ongoing, "ongoing");
  const substitutes = (slot: ChoiceSlot) => [...courses.values()]
    .filter((course) => course.applicable && course.electiveCode !== null && slot.electiveCodes.has(course.electiveCode))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const slot of choiceSlots) allocate(slot, substitutes(slot), done, "done");
  for (const slot of choiceSlots) allocate(slot, substitutes(slot), ongoing, "ongoing");

  for (const group of quotaGroups.values()) {
    for (const course of courses.values()) {
      if (!course.applicable || course.electiveCode !== group.code || allocated.has(course.code)) continue;
      if (done(course.state)) group.doneCredits += course.credits;
      else if (ongoing(course.state)) group.ongoingCredits += course.credits;
    }
  }

  const peCodes = [...new Set(Object.values(args.physicalEducationGroups).flat().map(courseKey))];
  const peCourses = peCodes.map((code) => courses.get(code)).filter((course): course is PlanCourseInfo => Boolean(course));
  const pePassed = peCourses.filter((course) => done(course.state)).length;
  const peOngoing = peCourses.filter((course) => ongoing(course.state)).length;
  const peCredits = (item: PlanItem) => item.credits ?? minCredits(peCourses);
  const slotLabel = (item: PlanItem, number: number) => item.name.trim() || `GDTC ${number}`;

  const late: LateEntry[] = [];
  let lateCount = 0, lateCredits = 0;
  type Timed = { term: string; order: number; entry: LateEntry };
  const timed: Timed[] = [];
  let order = 0;
  for (const { course, termCode } of plain.values()) {
    if (!due(termCode) || done(course.state) || ongoing(course.state)) continue;
    timed.push({ term: termCode, order: order++, entry: { kind: "course", code: course.code, name: course.name, credits: course.credits, termCode, state: course.state } });
    lateCount++; lateCredits += course.credits;
  }
  for (const slot of choiceSlots) {
    const missing = slot.need - slot.done - slot.ongoing;
    if (!due(slot.section.termCode) || missing <= 0) continue;
    const missingCredits = missing * minCredits(slot.options);
    timed.push({ term: slot.section.termCode, order: order++, entry: {
      kind: "choice", label: slot.section.label, termCode: slot.section.termCode, required: slot.need, unit: "course",
      missing, missingCredits, options: slot.options.map(ref),
    } });
    lateCount += missing; lateCredits += missingCredits;
  }
  for (const group of quotaGroups.values()) {
    if (group.quota === null || !due(group.dueTerm)) continue;
    const missingCredits = group.quota - group.doneCredits - group.ongoingCredits;
    if (missingCredits <= 0) continue;
    const options = group.items.map((entry) => entry.course);
    const missing = Math.max(1, Math.ceil(missingCredits / Math.max(maxCredits(options), 1)));
    timed.push({ term: group.dueTerm, order: order++, entry: {
      kind: "choice", label: `Nhóm tự chọn ${group.code}: chọn ${group.quota} tín chỉ`, termCode: group.dueTerm, required: group.quota,
      unit: "credit", missing, missingCredits, options: options.map(ref),
    } });
    lateCount += missing; lateCredits += missingCredits;
  }
  for (const { item, number } of slots) {
    if (!due(item.termCode) || pePassed + peOngoing >= number) continue;
    const credits = peCredits(item);
    timed.push({ term: item.termCode, order: order++, entry: {
      kind: "physical_education", label: slotLabel(item, number), termCode: item.termCode, required: number, passed: pePassed, missingCredits: credits,
    } });
    lateCount++; lateCredits += credits;
  }
  timed.sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : a.order - b.order));
  late.push(...timed.map((entry) => entry.entry));

  const termCodes = [...new Set([...args.plan.terms.map((term) => term.code), ...items.map((item) => item.termCode)])].sort();
  const nextTerm = termCodes.find((term) => currentTerm === null || term > currentTerm) ?? null;
  const next: NextEntry[] = [];
  let nextCredits = 0;
  if (nextTerm) {
    for (const { course, termCode } of plain.values()) {
      if (termCode !== nextTerm || done(course.state)) continue;
      next.push({ kind: "course", code: course.code, name: course.name, credits: course.credits, state: course.state });
      nextCredits += course.credits;
    }
    for (const slot of choiceSlots) {
      const remaining = slot.need - slot.done - slot.ongoing;
      if (slot.section.termCode !== nextTerm || remaining <= 0) continue;
      next.push({ kind: "choice", label: slot.section.label, required: slot.need, unit: "course", remaining, options: slot.options.map(ref) });
      nextCredits += remaining * minCredits(slot.options);
    }
    for (const group of quotaGroups.values()) {
      if (group.quota === null || !group.items.some((entry) => entry.termCode === nextTerm)) continue;
      const remaining = group.quota - group.doneCredits - group.ongoingCredits;
      if (remaining <= 0) continue;
      const options = group.items.map((entry) => entry.course).filter((course) => !done(course.state));
      next.push({ kind: "choice", label: `Nhóm tự chọn ${group.code}: chọn ${group.quota} tín chỉ`, required: group.quota, unit: "credit", remaining, options: options.map(ref) });
      nextCredits += remaining;
    }
    for (const { item, number } of slots) {
      if (item.termCode !== nextTerm || pePassed >= number) continue;
      next.push({ kind: "physical_education", label: slotLabel(item, number), required: number, passed: pePassed });
      nextCredits += peCredits(item);
    }
  }

  const informationalSections = [...informational.values()].map((entry) => ({ label: entry.label, termCode: entry.termCode, options: entry.options.map(ref) }));
  for (const group of quotaGroups.values()) {
    if (group.quota !== null) continue;
    informationalSections.push({ label: `Nhóm tự chọn ${group.code}`, termCode: group.dueTerm, options: group.items.map((entry) => ref(entry.course)) });
  }
  return {
    currentTerm, nextTerm, late, lateCount, lateCredits, next, nextCount: next.length, nextCredits,
    informationalSections, countMismatches,
  };
}
