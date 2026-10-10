export const adminNavigation = [
  { path: "/quantri/tai-khoan", label: "Danh sách tài khoản", eyebrow: "QUẢN LÝ TÀI KHOẢN", breadcrumb: "Người dùng", icon: "users" },
  { path: "/quantri/sinh-vien", label: "Hồ sơ sinh viên", eyebrow: "QUẢN LÝ HỒ SƠ SINH VIÊN", breadcrumb: "Hồ sơ sinh viên", icon: "profile" },
  { path: "/quantri/chuong-trinh", label: "Chương trình đào tạo", eyebrow: "QUẢN LÝ ĐÀO TẠO", breadcrumb: "Khung CTĐT", icon: "book" },
  { path: "/quantri/tieu-chuan-tot-nghiep", label: "Tiêu chuẩn xét tốt nghiệp", eyebrow: "QUẢN LÝ ĐÀO TẠO", breadcrumb: "Tiêu chuẩn tốt nghiệp", icon: "shield" },
  { path: "/quantri/ke-hoach", label: "Kế hoạch đào tạo", eyebrow: "QUẢN LÝ ĐÀO TẠO", breadcrumb: "Kế hoạch đào tạo", icon: "book" },
  { path: "/quantri/vi-tri-nghe-nghiep", label: "Quản lý nghề nghiệp", eyebrow: "QUẢN LÝ NGHỀ NGHIỆP", breadcrumb: "Nghề nghiệp", icon: "users" },
  { path: "/quantri/linh-vuc-nghe-nghiep", label: "Lĩnh vực nghề nghiệp", eyebrow: "QUẢN LÝ NGHỀ NGHIỆP", breadcrumb: "Lĩnh vực nghề nghiệp", icon: "book" },
  { path: "/quantri/ky-nang", label: "Danh sách kỹ năng", eyebrow: "QUẢN LÝ NGHỀ NGHIỆP", breadcrumb: "Danh sách kỹ năng", icon: "book" },
  { path: "/quantri/danh-gia-nang-luc", label: "Đánh giá năng lực", eyebrow: "QUẢN LÝ ĐÀO TẠO", breadcrumb: "Đánh giá năng lực", icon: "profile" }
] as const;
export function resolveAdminPage(pathname: string) {
  return adminNavigation.find((item) => item.path === pathname.replace(/\/+$/, "")) ?? adminNavigation[0];
}
