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
export type AdminPage = (typeof adminNavigation)[number];

/**
 * Sidebar groups: one entry that opens and closes, with its pages below it. A group sits where its
 * first page is in adminNavigation; its pages keep their own paths, titles and breadcrumbs.
 */
export const adminNavigationGroups = [
  { id: "careers", label: "Quản lý nghề nghiệp", icon: "briefcase", paths: ["/quantri/vi-tri-nghe-nghiep", "/quantri/linh-vuc-nghe-nghiep", "/quantri/ky-nang"] }
] as const;

export type AdminSidebarEntry =
  | { kind: "page"; page: AdminPage }
  | { kind: "group"; id: string; label: string; icon: string; pages: AdminPage[] };

/** What the sidebar shows, in order: single pages and groups. */
export const adminSidebar: AdminSidebarEntry[] = adminNavigation.flatMap((page): AdminSidebarEntry[] => {
  const group = adminNavigationGroups.find((item) => (item.paths as readonly string[]).includes(page.path));
  if (!group) return [{ kind: "page", page }];
  if (group.paths[0] !== page.path) return [];
  const pages = group.paths.map((path) => adminNavigation.find((item) => item.path === path)!);
  return [{ kind: "group", id: group.id, label: group.label, icon: group.icon, pages }];
});

export function resolveAdminPage(pathname: string) {
  return adminNavigation.find((item) => item.path === pathname.replace(/\/+$/, "")) ?? adminNavigation[0];
}
