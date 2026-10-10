export type CareerField = {
  id: string;
  code: string;
  name: string;
  description: string;
  version: string;
  positionCount?: number;
};
export type Career = {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  category: string;
  categoryName?: string;
  description: string;
  /** Display/search cache of active skill links; edit via career requirements. */
  skills: string[];
  version: string;
  deletedAt: string | null;
  studentCount?: number;
};
export type CareerSelection = Pick<
  Career,
  "id" | "nameVi" | "nameEn" | "deletedAt"
>;
export type CareerSkill = { id: string; name: string };
export type ManagedCareerSkill = CareerSkill & { description: string; version: string; careerCount: number; assessmentCount?: number };
export type CareerRequirement = {
  id: string;
  careerPositionId: string;
  careerName: string;
  careerNameEn: string;
  category: string;
  categoryName: string;
  skillId: string | null;
  skillName: string | null;
  title: string;
  description: string;
  isRequired: boolean;
  version: string;
};
export type StudentCareerDetail = Pick<Career, "id" | "code" | "nameVi" | "nameEn" | "category" | "categoryName" | "description"> & {
  requirements: Pick<CareerRequirement, "id" | "title" | "description" | "skillName" | "isRequired">[];
};
export const careerFailures: Record<string, string> = {
  requirement_changed: "Yêu cầu đã được cập nhật hoặc xóa. Đóng hộp thoại và tải lại trước khi lưu.",
  requirement_exists: "Kỹ năng đã tồn tại",
  requirement_not_found: "Yêu cầu không còn trong danh mục.",
  invalid_requirement: "Thông tin chưa hợp lệ. Kiểm tra nghề nghiệp, nội dung, kỹ năng và tính chất yêu cầu.",
  skill_not_found: "Kỹ năng không còn trong danh mục. Hãy tải lại và chọn lại.",
  skill_exists: "Tên kỹ năng đã tồn tại. Hãy dùng tên khác.",
  skill_changed: "Kỹ năng đã được cập nhật hoặc xóa. Đóng hộp thoại và tải lại trước khi lưu.",
  skill_in_use: "Kỹ năng còn được dùng bởi nghề nghiệp hoặc danh mục Đánh giá năng lực. Hãy kiểm tra các liên kết và hồ sơ đánh giá trước khi xóa kỹ năng dùng chung.",
  invalid_skill: "Thông tin chưa hợp lệ. Kiểm tra tên và mô tả kỹ năng.",
  field_exists: "Tên lĩnh vực đã tồn tại. Hãy dùng tên khác.",
  field_changed: "Lĩnh vực đã được cập nhật hoặc xóa. Đóng hộp thoại và tải lại trước khi lưu.",
  field_in_use: "Lĩnh vực còn vị trí nghề nghiệp đang sử dụng. Hãy chuyển hoặc xóa các vị trí đó trước khi xóa lĩnh vực.",
  field_unavailable: "Lĩnh vực vừa bị xóa hoặc không còn sử dụng. Hãy tải lại và chọn lĩnh vực khác.",
  invalid_field: "Thông tin chưa hợp lệ. Kiểm tra tên và mô tả lĩnh vực.",
  career_exists: "Tên song ngữ đã tồn tại. Hãy dùng tên khác.",
  career_changed:
    "Vị trí đã được cập nhật hoặc xóa. Đóng hộp thoại và tải lại trước khi lưu.",
  career_not_found: "Vị trí không còn trong danh mục.",
  invalid_career:
    "Thông tin chưa hợp lệ. Kiểm tra tên, lĩnh vực và các trường đã nhập.",
  insufficient_role: "Bạn không còn quyền thực hiện thao tác này.",
  authentication_required:
    "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
};
export async function careerRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const body = await res.json();
  if (!res.ok)
    throw new Error(
      careerFailures[body.error] ??
        "Không thể thực hiện thao tác. Vui lòng thử lại.",
    );
  return body;
}
