export const adminNavigation = [
  { path: "/quantri/tai-khoan", label: "Danh sách tài khoản người dùng", eyebrow: "QUẢN LÝ TÀI KHOẢN", breadcrumb: "Người dùng", icon: "users" },
  { path: "/quantri/sinh-vien", label: "Hồ sơ sinh viên", eyebrow: "QUẢN LÝ HỒ SƠ SINH VIÊN", breadcrumb: "Hồ sơ sinh viên", icon: "profile" }
] as const;
export function resolveAdminPage(pathname: string) {
  return adminNavigation.find((item) => item.path === pathname.replace(/\/+$/, "")) ?? adminNavigation[0];
}
