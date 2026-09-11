import type { Transcript } from "./StudentTranscript";

type Semester = Transcript["data"]["sections"][number];

export function academicSections(transcript: Transcript | null): Semester[] {
  return (transcript?.data.sections ?? [])
    .filter(section => section.academicYear !== null && section.semester !== null)
    .slice()
    .sort((a, b) => a.academicYear!.localeCompare(b.academicYear!) || Number(a.semester!.replace(/\D/g, "")) - Number(b.semester!.replace(/\D/g, "")));
}

export function latestResultSection(sections: Semester[]): Semester | undefined {
  return [...sections].reverse().find(section => section.courses.some(course => course.score10 !== null || course.score4 !== null)) ?? sections.at(-1);
}

// Keep the institution's printed summary; never average rows or infer missing GPA.
export function printedSemesterGpa(section: Semester | undefined): string | null {
  return section?.summaries.find(summary => {
    const label = summary.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d");
    return label.includes("diem tb hoc ky") && label.includes("he 4");
  })?.value ?? null;
}
