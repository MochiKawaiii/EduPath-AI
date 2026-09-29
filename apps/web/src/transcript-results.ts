type ResultCourse = { code: string; result: string | null };
export type CourseResult = "pass" | "fail";

export function transcriptResults(sections: { courses: ResultCourse[] }[]) {
  const results = new Map<string, CourseResult>();
  for (const course of sections.flatMap((section) => section.courses)) {
    const code = course.code.trim().toUpperCase();
    const text = (course.result ?? "").trim().toLowerCase();
    const failed = /^(không|khong|chưa|chua|ko)\s*đạt|^(rớt|trượt)|^[✗✘×x]$/.test(text);
    const passed = !failed && (/^đạt/.test(text) || /^[✓✔v]$/.test(text));
    // Passing any attempt satisfies the course; an unknown result is left blank.
    if (code && passed) results.set(code, "pass");
    else if (code && failed && results.get(code) !== "pass") results.set(code, "fail");
  }
  return results;
}
