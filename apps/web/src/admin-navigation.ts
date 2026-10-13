export const adminNavigation = [
  { path: "/quantri/tai-khoan", label: "Tài khoản", eyebrow: "QUẢN LÝ TÀI KHOẢN", icon: "users" },
  { path: "/quantri/sinh-vien", label: "Sinh viên", eyebrow: "QUẢN LÝ HỒ SƠ SINH VIÊN", icon: "profile" },
  { path: "/quantri/chuong-trinh", label: "Chương trình", eyebrow: "QUẢN LÝ ĐÀO TẠO", icon: "book" },
  { path: "/quantri/tieu-chuan-tot-nghiep", label: "Tốt nghiệp", eyebrow: "QUẢN LÝ ĐÀO TẠO", icon: "shield" },
  { path: "/quantri/ke-hoach", label: "Kế hoạch", eyebrow: "QUẢN LÝ ĐÀO TẠO", icon: "book" },
  { path: "/quantri/vi-tri-nghe-nghiep", label: "Nghề nghiệp", eyebrow: "QUẢN LÝ NGHỀ NGHIỆP", icon: "users" },
  { path: "/quantri/linh-vuc-nghe-nghiep", label: "Lĩnh vực", eyebrow: "QUẢN LÝ NGHỀ NGHIỆP", icon: "book" },
  { path: "/quantri/ky-nang", label: "Kỹ năng", eyebrow: "QUẢN LÝ NGHỀ NGHIỆP", icon: "book" },
  { path: "/quantri/danh-gia-nang-luc", label: "Năng lực", eyebrow: "QUẢN LÝ ĐÀO TẠO", icon: "profile" }
] as const;
export function resolveAdminPage(pathname: string) {
  return adminNavigation.find((item) => item.path === pathname.replace(/\/+$/, "")) ?? adminNavigation[0];
}
