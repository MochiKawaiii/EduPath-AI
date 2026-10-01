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
  skills: string[];
  version: string;
  deletedAt: string | null;
  studentCount?: number;
};
export type CareerSelection = Pick<
  Career,
  "id" | "nameVi" | "nameEn" | "deletedAt"
>;
export const requirementLevels = {
  unspecified: "Chưa xác định",
  basic: "Cơ bản",
  intermediate: "Trung cấp",
  advanced: "Nâng cao",
};
export type CareerSkill = { id: string; name: string };
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
  level: keyof typeof requirementLevels;
  isRequired: boolean;
  version: string;
};
export const careerFailures: Record<string, string> = {
  requirement_changed: "Yêu cầu đã được cập nhật hoặc xóa. Đóng hộp thoại và tải lại trước khi lưu.",
  requirement_exists: "Kỹ năng này đã liên kết với vị trí nghề nghiệp. Hãy chỉnh sửa liên kết hiện có.",
  requirement_not_found: "Yêu cầu không còn trong danh mục.",
  invalid_requirement: "Thông tin chưa hợp lệ. Kiểm tra nghề nghiệp, nội dung, kỹ năng và mức yêu cầu.",
  skill_not_found: "Kỹ năng không còn trong danh mục. Hãy tải lại và chọn lại.",
  field_exists: "Mã hoặc tên lĩnh vực đã tồn tại. Hãy dùng thông tin khác.",
  field_changed: "Lĩnh vực đã được cập nhật hoặc xóa. Đóng hộp thoại và tải lại trước khi lưu.",
  field_in_use: "Lĩnh vực còn vị trí nghề nghiệp đang sử dụng. Hãy chuyển hoặc xóa các vị trí đó trước khi xóa lĩnh vực.",
  field_unavailable: "Lĩnh vực vừa bị xóa hoặc không còn sử dụng. Hãy tải lại và chọn lĩnh vực khác.",
  invalid_field: "Thông tin chưa hợp lệ. Kiểm tra mã, tên và mô tả lĩnh vực.",
  career_exists: "Mã hoặc tên song ngữ đã tồn tại. Hãy dùng thông tin khác.",
  career_changed:
    "Vị trí đã được cập nhật hoặc xóa. Đóng hộp thoại và tải lại trước khi lưu.",
  career_not_found: "Vị trí không còn trong danh mục.",
  invalid_career:
    "Thông tin chưa hợp lệ. Kiểm tra tên, mã và các trường đã nhập.",
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
