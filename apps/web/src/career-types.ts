export const careerCategories: Record<string, string> = {
  software: "Phát triển phần mềm",
  data_ai: "Dữ liệu & Trí tuệ nhân tạo",
  security: "An toàn thông tin",
  infrastructure: "Hạ tầng & Điện toán đám mây",
  quality: "Kiểm thử & Chất lượng",
  product: "Nghiệp vụ & Thiết kế",
};
export type Career = {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  category: string;
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
export const careerFailures: Record<string, string> = {
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
