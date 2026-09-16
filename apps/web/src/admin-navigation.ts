export const adminNavigation = [
  { path: "/quantri/tai-khoan", label: "Danh sách tài khoản", eyebrow: "QUẢN LÝ TÀI KHOẢN", breadcrumb: "Người dùng", icon: "users" },
  { path: "/quantri/sinh-vien", label: "Hồ sơ sinh viên", eyebrow: "QUẢN LÝ HỒ SƠ SINH VIÊN", breadcrumb: "Hồ sơ sinh viên", icon: "profile" },
  { path: "/quantri/chuong-trinh", label: "Chương trình đào tạo", eyebrow: "QUẢN LÝ ĐÀO TẠO", breadcrumb: "Khung CTĐT", icon: "book" },
  { path: "/quantri/ke-hoach", label: "Kế hoạch đào tạo", eyebrow: "QUẢN LÝ ĐÀO TẠO", breadcrumb: "Kế hoạch đào tạo", icon: "book" }
] as const;
export function resolveAdminPage(pathname: string) {
  return adminNavigation.find((item) => item.path === pathname.replace(/\/+$/, "")) ?? adminNavigation[0];
}
