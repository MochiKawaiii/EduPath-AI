import { useState } from "react";
import { useLiveData } from "./use-live-data";

export const COMPETENCY_API = "/api/admin/competencies";
export const WEIGHT_TOLERANCE = 0.000001;
export type Group = { id: string; name: string; description: string; isActive: boolean; version: string; skillCount: number };
export type CatalogSkill = { id: string; name: string; description: string; version: string };
export type Skill = CatalogSkill & { scope: string; groupId: string; groupName: string; isActive: boolean; groupActive: boolean; careerCount: number; courseCount: number; legacySkillId: string | null };
export type EventEntry = { id: string; note: string; createdAt: string; actorName?: string | null; kind?: string; snapshot: unknown };
export type Contribution = { revisionId: string; cohortCode: string; curriculumName: string; curriculumVersion: number; isCurrent: boolean; courseCode: string; courseName: string; weight: number; status: ConfigurationStatus };
export type SkillDetail = Skill & { contributions: Contribution[]; history?: EventEntry[]; events?: EventEntry[] };
export type ConfigurationStatus = "draft" | "active" | "archived";
export type CourseStatus = ConfigurationStatus | "missing";
export type CurriculumRevision = { curriculumId: string; revisionId: string; cohortCode: string; name: string; version: number; isCurrent: boolean; isActive: boolean; courseCount: number; configuredCount: number; activeCount: number; draftCount: number };
export type CompetencyCourse = { code: string; name: string; credits: number; type: string; block: string; specialty: string; occurrenceCount: number; status: CourseStatus; configId: string | null; version: string | null; skillCount: number; totalWeight: number };
export type CourseLink = { skillId: string; skillName: string; groupId: string; groupName: string; isActive: boolean; weight: number };
export type CourseDetail = { revisionId: string; courseCode: string; courseName: string; occurrenceCount: number; configId: string | null; status: CourseStatus; version: string | null; note: string; links: CourseLink[]; history: EventEntry[] };
export type CompetencySummary = { revisionId: string; cohortCode: string; curriculumName: string; curriculumVersion: number; isCurrent: boolean; courseCount: number; activeCount: number; draftCount: number; archivedCount: number; missingCount: number; skillCount: number; unlinkedSkillCount: number; warnings: { code: string; message: string; courseCode?: string }[] };
export type ImportIssue = { sheet: string; row: number | null; code: string; message: string };
export type ImportCounts = { skillRows: number; linkRows: number; courses: number; validRows: number; errorRows: number; groupsToCreate: number; skillsToCreate: number; skillsToReuse: number; legacySkillsMapped: number; skillsToUpdate: number; coursesToCreate: number; coursesToUpdate: number; coursesUnchanged: number; linksToCreate: number; linksToUpdate: number; linksToRemove: number };
export type ImportPreview = { token: string; revisionId: string; cohortCode: string; filename: string; counts: ImportCounts; skills: { name: string; group: string; scope: string; skillId: string | null; legacySkillId: string | null; action: "create" | "reuse" | "unchanged" | "update"; previousScope?: string; previousGroup?: string }[]; courses: { courseCode: string; courseName: string; rowCount: number; totalWeight: number; action: "create" | "update" | "unchanged" | "error"; changes?: { skillName: string; beforeWeight: number | null; afterWeight: number | null }[] }[]; errors: ImportIssue[]; warnings: ImportIssue[]; canImport: boolean; requiresOverwrite: boolean };
export type ImportResult = { imported: true; summary: ImportCounts; importId: string | null; unchanged: boolean; warnings: ImportIssue[] };

export const statusLabels: Record<CourseStatus, string> = { missing: "Chưa cấu hình", draft: "Bản nháp", active: "Đang áp dụng", archived: "Đã lưu trữ" };
export const importActionLabels = { create: "Tạo mới", reuse: "Dùng kỹ năng chung", update: "Cập nhật", unchanged: "Không thay đổi", error: "Có lỗi" };
export const percentage = (weight: number) => `${Number((weight * 100).toFixed(6)).toLocaleString("vi-VN", { maximumFractionDigits: 6 })}%`;
export const competencyDate = (date: string) => new Date(date).toLocaleString("vi-VN");

const failures: Record<string, string> = {
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  insufficient_role: "Bạn không còn quyền thay đổi dữ liệu đánh giá năng lực.",
  invalid_origin: "Không xác nhận được yêu cầu. Hãy tải lại trang rồi thử lại.",
  database_required: "Chức năng đánh giá năng lực cần kết nối cơ sở dữ liệu.",
  not_found: "Không tìm thấy dữ liệu. Hãy tải lại danh sách.",
  invalid_input: "Thông tin chưa hợp lệ. Hãy kiểm tra các trường đã nhập.",
  invalid_competency_input: "Thông tin chưa hợp lệ. Hãy kiểm tra nhóm, kỹ năng và trọng số đã nhập.",
  invalid_competency_query: "Bộ lọc chưa hợp lệ. Hãy chọn lại khóa, phiên bản và trạng thái.",
  invalid_group: "Thông tin nhóm chưa hợp lệ. Kiểm tra tên và mô tả.",
  invalid_skill: "Thông tin kỹ năng chưa hợp lệ. Kiểm tra tên, nhóm và phạm vi.",
  invalid_configuration: "Cấu hình chưa hợp lệ. Kiểm tra kỹ năng và trọng số.",
  group_exists: "Tên nhóm đã tồn tại. Hãy dùng tên khác.",
  group_changed: "Nhóm đã được thay đổi. Đóng hộp thoại và tải lại trước khi lưu.",
  group_in_use: "Nhóm đang được cấu hình học phần áp dụng sử dụng. Hãy điều chỉnh các cấu hình trước.",
  group_not_found: "Không tìm thấy nhóm kỹ năng.",
  group_inactive: "Nhóm đang ngừng sử dụng. Chọn nhóm hoạt động để áp dụng cấu hình.",
  group_unavailable: "Nhóm đang ngừng sử dụng. Chọn nhóm hoạt động để áp dụng cấu hình.",
  skill_exists: "Kỹ năng đã có trong danh mục. Nếu kỹ năng chung đã tồn tại, hãy chọn dùng lại kỹ năng đó.",
  skill_profile_exists: "Kỹ năng chung này đã có hồ sơ đánh giá năng lực.",
  canonical_skill_mismatch: "Tên và mô tả phải khớp với kỹ năng chung đã chọn. Hãy tải lại danh mục rồi chọn lại.",
  shared_skill_exists: "Tên này đã có trong danh mục kỹ năng chung. Hãy chọn kỹ năng chung để dùng lại.",
  skill_changed: "Kỹ năng đã được thay đổi. Đóng hộp thoại và tải lại trước khi lưu.",
  skill_in_use: "Kỹ năng đang được cấu hình áp dụng sử dụng. Hãy gỡ hoặc lưu trữ các cấu hình đó trước.",
  skill_not_found: "Kỹ năng không còn trong danh mục. Hãy tải lại và chọn lại.",
  skill_unavailable: "Kỹ năng hoặc nhóm của kỹ năng đang ngừng sử dụng.",
  configuration_changed: "Cấu hình đã được thay đổi. Đóng hộp thoại và tải lại trước khi lưu.",
  course_changed: "Cấu hình đã được thay đổi. Đóng hộp thoại và tải lại trước khi lưu.",
  configuration_not_found: "Không tìm thấy cấu hình học phần.",
  configuration_scope_immutable: "Cấu hình phải giữ đúng khóa, phiên bản và mã học phần. Hãy tải lại dữ liệu.",
  invalid_competency_reference: "Nhóm, kỹ năng hoặc học phần đã thay đổi. Hãy tải lại danh sách và chọn lại.",
  competency_input_too_large: "Cấu hình có quá nhiều dữ liệu. Mỗi học phần hỗ trợ tối đa 200 kỹ năng.",
  configuration_exists: "Học phần vừa được tạo cấu hình. Đóng hộp thoại và tải lại trước khi lưu.",
  duplicate_curriculum_course: "Mã học phần xuất hiện nhiều lần trong phiên bản khung. Cần rà soát trước khi cấu hình.",
  duplicate_course: "Mã học phần xuất hiện nhiều lần trong phiên bản khung. Cần rà soát trước khi cấu hình.",
  ambiguous_course: "Mã học phần xuất hiện nhiều lần trong phiên bản khung. Cần rà soát trước khi cấu hình.",
  invalid_weights: "Trọng số phải nằm trong khoảng 0–100%. Cấu hình áp dụng phải có tổng 100%.",
  invalid_weight: "Trọng số phải là số từ 0 đến 100%.",
  weight_total_invalid: "Cấu hình áp dụng phải có ít nhất một kỹ năng và tổng trọng số bằng 100%.",
  duplicate_skill_link: "Một kỹ năng chỉ được xuất hiện một lần trong cấu hình.",
  invalid_weight_total: "Tổng trọng số của cấu hình áp dụng phải bằng 100%.",
  duplicate_skill: "Một kỹ năng chỉ được xuất hiện một lần trong cấu hình.",
  invalid_version: "Thiếu phiên bản dữ liệu. Hãy đóng hộp thoại và tải lại trước khi lưu.",
  version_conflict: "Dữ liệu đã được người khác thay đổi. Hãy tải lại trước khi lưu.",
  invalid_revision: "Hãy chọn đúng phiên bản chương trình đào tạo.",
  revision_not_found: "Phiên bản chương trình đào tạo không còn tồn tại.",
  curriculum_revision_not_found: "Phiên bản chương trình đào tạo không còn tồn tại.",
  curriculum_not_found: "Phiên bản chương trình đào tạo không còn tồn tại.",
  course_not_found: "Mã học phần không thuộc phiên bản chương trình đã chọn.",
  confirmation_required: "Cần xác nhận thao tác trước khi tiếp tục.",
  invalid_workbook: "Không đọc được tệp Excel. Hãy chọn tệp .xlsx có trang skills và course_skills.",
  unsafe_workbook_cell: "Tệp có ô công thức hoặc kiểu dữ liệu không được hỗ trợ. Hãy sửa ô được chỉ ra và chọn lại tệp.",
  unsupported_workbook: "Tệp Excel chưa đúng mẫu skills và course_skills.",
  invalid_filename: "Tên tệp chưa hợp lệ. Hãy chọn tệp .xlsx.",
  workbook_too_large: "Tệp Excel vượt giới hạn 5 MB hoặc giới hạn số dòng.",
  import_busy: "Hệ thống đang đọc một tệp Excel khác. Vui lòng thử lại sau.",
  import_timeout: "Đọc tệp Excel quá lâu. Hãy kiểm tra tệp và thử lại.",
  import_errors: "Tệp còn lỗi. Hãy sửa đầy đủ các lỗi trong bản xem trước rồi chọn lại tệp.",
  import_has_errors: "Tệp còn lỗi. Hãy sửa đầy đủ các lỗi trong bản xem trước rồi chọn lại tệp.",
  import_preview_changed: "Tệp hoặc dữ liệu đã thay đổi. Hãy xem trước lại trước khi nhập.",
  confirm_overwrite: "Cần xác nhận ghi đè những cấu hình đã được chỉnh sửa trước khi nhập.",
  invalid_source_cohort: "Khóa nguồn chưa hợp lệ. Nhập mã khóa theo dạng K29.",
  cohort_mismatch: "Khóa nguồn, tên tệp và phiên bản chương trình đã chọn không khớp.",
  import_cohort_mismatch: "Khóa nguồn, tên tệp và phiên bản chương trình đã chọn không khớp.",
  stale_preview: "Dữ liệu đã thay đổi hoặc bản xem trước hết hạn. Hãy xem trước lại trước khi nhập.",
  preview_changed: "Dữ liệu đã thay đổi. Hãy xem trước lại trước khi nhập.",
  preview_token_invalid: "Bản xem trước không còn hợp lệ. Hãy xem trước lại.",
  review_warnings: "Cần rà soát và xác nhận tất cả cảnh báo trước khi nhập.",
  confirm_warnings_required: "Cần xác nhận đã rà soát các cảnh báo trước khi nhập.",
  overwrite_confirmation_required: "Cần xác nhận ghi đè những cấu hình đã được chỉnh sửa trước khi nhập.",
  confirm_overwrite_required: "Cần xác nhận ghi đè những cấu hình đã được chỉnh sửa trước khi nhập.",
};

export async function readCompetencyResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    const details = Array.isArray(body.details) ? body.details.filter((detail: unknown) => typeof detail === "string").join("\n") : "";
    const message = failures[body.error] ?? (typeof body.message === "string" ? body.message : response.status === 409 ? "Dữ liệu đã được thay đổi. Hãy tải lại trước khi tiếp tục." : "Chưa thực hiện được thao tác. Vui lòng thử lại.");
    throw new Error(message + (details ? `\n${details}` : ""));
  }
  return body as T;
}
export async function competencyRequest<T>(url: string, init?: RequestInit): Promise<T> {
  try { return await fetch(url, { ...init, credentials: "include", cache: "no-store" }).then(readCompetencyResponse<T>); }
  catch (failure) { if (failure instanceof TypeError) throw new Error("Không thể kết nối hệ thống. Hãy kiểm tra kết nối và thử lại."); throw failure; }
}
export function useCompetencyData<T>(url: string, revision = 0) {
  const [retry, setRetry] = useState(0);
  const remote = useLiveData<T>(url, `${revision}.${retry}`, readCompetencyResponse);
  const error = remote.error && /^(Failed to fetch|NetworkError|Load failed|fetch failed)/iu.test(remote.error) ? "Không thể kết nối hệ thống. Hãy kiểm tra kết nối và thử lại." : remote.error;
  return { ...remote, error, retry: () => setRetry(value => value + 1) };
}
