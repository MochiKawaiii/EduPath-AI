// Reading GET /api/student/graduation, shared by the graduation page and the graduation
// section of the competency page, so both show the server's one evaluation.
import { loadErrorMessage } from "./student-graduation-data";
import type { StudentGraduationResponse } from "./student-graduation-types";

export async function readGraduation(response: Response): Promise<StudentGraduationResponse> {
  const data = await response.json().catch(() => null) as (StudentGraduationResponse & { error?: string }) | null;
  // A body without a profile/resolution is not this API's answer (e.g. an older server): say so instead of breaking.
  if (!response.ok || !data?.profile || !data.resolution) throw new Error(loadErrorMessage(response.status, data?.error));
  return data;
}
