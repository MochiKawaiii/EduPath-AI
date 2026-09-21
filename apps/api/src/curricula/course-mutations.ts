import {
  CurriculumError,
  courseSchema,
  type CurriculumData,
  type CurriculumCourse,
} from "./model.js";

export const courseInput = courseSchema
  .omit({
    position: true,
    sourceRow: true,
    sourceSheet: true,
    sourceCells: true,
  })
  .extend({
    englishName: courseSchema.shape.englishName.default(""),
    description: courseSchema.shape.description.default(""),
    type: courseSchema.shape.type.default(""),
    block: courseSchema.shape.block.default(""),
    specialty: courseSchema.shape.specialty.default(""),
    semester: courseSchema.shape.semester.default(null),
    studyYear: courseSchema.shape.studyYear.default(null),
    prerequisite: courseSchema.shape.prerequisite.default(""),
    prior: courseSchema.shape.prior.default(""),
    notes: courseSchema.shape.notes.default(""),
    department: courseSchema.shape.department.default(""),
    departmentCode: courseSchema.shape.departmentCode.default(""),
    hours: courseSchema.shape.hours.default({
      lecture: null,
      practice: null,
      project: null,
      internship: null,
    }),
  })
  .strict();

/** Numbered headings are containers when another block has a child number. */
export function parentGroupIds(groups: CurriculumData["groups"]): Set<string> {
  const numbered = groups.map((group) => ({
    id: group.id,
    code: group.label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .replace(/^Khoi kien thuc:\s*/i, "")
      .match(/^([A-Z]+(?:\.?\d+)*)(?=[.\s:])/i)?.[1]
      ?.toUpperCase(),
  }));
  return new Set(
    numbered
      .filter(
        (parent) =>
          parent.code &&
          numbered.some(
            (child) =>
              child.id !== parent.id &&
              child.code?.startsWith(parent.code!) &&
              (/\d$/.test(parent.code!) ? /^\.\d/ : /^\.?\d/).test(
                child.code.slice(parent.code!.length),
              ),
          ),
      )
      .map((group) => group.id),
  );
}

function placeCourses(data: CurriculumData) {
  const order = new Map(data.groups.map((group, index) => [group.id, index]));
  data.courses.sort(
    (a, b) =>
      (order.get(a.groupId) ?? -1) - (order.get(b.groupId) ?? -1) ||
      a.position - b.position,
  );
  data.courses.forEach((course, index) => {
    course.position = index + 1;
  });
  return data;
}

export function putCourse(
  data: CurriculumData,
  input: unknown,
  previousCode?: string,
) {
  const index =
    previousCode === undefined
      ? -1
      : data.courses.findIndex((c) => c.code === previousCode);
  if (previousCode !== undefined && index < 0)
    throw new CurriculumError("not_found", 404);
  const change = courseInput.parse(input);
  const group = data.groups.find((g) => g.id === change.groupId);
  if (!group || parentGroupIds(data.groups).has(group.id))
    throw new CurriculumError("invalid_course_group", 400);
  if (data.courses.some((c, i) => c.code === change.code && i !== index))
    throw new CurriculumError("duplicate_course", 409, [change.code]);
  if (index < 0 && data.courses.length >= 2000)
    throw new CurriculumError("too_many_courses", 400);
  const original = data.courses[index];
  const provenance = original ?? {
    position: data.courses.length + 1,
    sourceRow: 0,
    sourceSheet: "Thêm trực tiếp",
    sourceCells: {},
  };
  const course: CurriculumCourse = { ...provenance, ...change };
  if (!original || original.groupId !== change.groupId)
    course.block =
      data.courses.find((c) => c.groupId === group.id && c.block)?.block ??
      group.label;
  if (original) data.courses[index] = course;
  else data.courses.push(course);
  // Raw prerequisite text remains unchanged; rebuild flags references to removed/renamed codes.
  return placeCourses(data);
}

export function removeCourse(data: CurriculumData, code: string) {
  const index = data.courses.findIndex((c) => c.code === code);
  if (index < 0) throw new CurriculumError("not_found", 404);
  data.courses.splice(index, 1);
  return placeCourses(data);
}
