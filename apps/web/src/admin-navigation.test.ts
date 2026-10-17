import { describe, expect, it } from "vitest";
import { adminNavigation, adminSidebar, resolveAdminPage } from "./admin-navigation";
describe("admin section navigation", () => {
  it("has account, student-profile, curriculum, graduation, training-plan, career, career-field, skill and competency sections", () => {
    expect(adminNavigation.map(item => item.path)).toEqual(["/quantri/tai-khoan", "/quantri/sinh-vien", "/quantri/chuong-trinh", "/quantri/tieu-chuan-tot-nghiep", "/quantri/ke-hoach", "/quantri/linh-vuc-nghe-nghiep", "/quantri/ky-nang", "/quantri/vi-tri-nghe-nghiep", "/quantri/nhom-nang-luc", "/quantri/cau-hinh-nang-luc", "/quantri/cau-hinh-hoc-phan"]);
  });
  it("uses short sidebar names, which are also the page title and breadcrumb", () => {
    expect(adminNavigation.map(item => item.label)).toEqual(["Tài khoản", "Sinh viên", "Chương trình", "Tốt nghiệp", "Kế hoạch", "Lĩnh vực", "Kỹ năng", "Nghề nghiệp", "Nhóm năng lực", "Cấu hình năng lực", "Cấu hình học phần"]);
  });
  it("groups the career pages under Quản lý nghề nghiệp and the competency pages under Quản lý năng lực", () => {
    expect(adminSidebar.map(entry => entry.kind === "page" ? entry.page.label : `${entry.label}: ${entry.pages.map(page => page.label).join(", ")}`))
      .toEqual(["Tài khoản", "Sinh viên", "Chương trình", "Tốt nghiệp", "Kế hoạch", "Quản lý nghề nghiệp: Lĩnh vực, Kỹ năng, Nghề nghiệp",
        "Quản lý năng lực: Nhóm năng lực, Cấu hình năng lực, Cấu hình học phần"]);
    expect(adminNavigation.filter(item => item.eyebrow === "QUẢN LÝ NĂNG LỰC").map(item => item.label)).toEqual(["Nhóm năng lực", "Cấu hình năng lực", "Cấu hình học phần"]);
  });
  it.each(["/quantri/sinh-vien", "/quantri/sinh-vien/"])("resolves direct student link %s", path => {
    expect(resolveAdminPage(path).label).toBe("Sinh viên");
  });
  it.each(["/quantri/ke-hoach", "/quantri/ke-hoach/"])("resolves direct training-plan link %s", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/ke-hoach");
  });
  it.each(["/quantri/tieu-chuan-tot-nghiep", "/quantri/tieu-chuan-tot-nghiep/"])("resolves direct graduation link %s", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/tieu-chuan-tot-nghiep");
  });
  it.each(["/quantri/vi-tri-nghe-nghiep", "/quantri/vi-tri-nghe-nghiep/"])("resolves direct career link %s", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/vi-tri-nghe-nghiep");
  });
  it.each(["/quantri/linh-vuc-nghe-nghiep", "/quantri/linh-vuc-nghe-nghiep/"])("resolves direct career-field link %s", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/linh-vuc-nghe-nghiep", label: "Lĩnh vực" });
  });
  it.each(["/quantri/ky-nang", "/quantri/ky-nang/"])("resolves direct skill link %s", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/ky-nang", label: "Kỹ năng" });
  });
  it.each([["/quantri/nhom-nang-luc", "Nhóm năng lực"], ["/quantri/cau-hinh-nang-luc/", "Cấu hình năng lực"], ["/quantri/cau-hinh-hoc-phan", "Cấu hình học phần"]])("resolves direct competency link %s", (path, label) => {
    expect(resolveAdminPage(path).label).toBe(label);
  });
  it.each(["/quantri/danh-gia-nang-luc", "/quantri/danh-gia-nang-luc/"])("opens Nhóm năng lực for the old Năng lực link %s", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/nhom-nang-luc", label: "Nhóm năng lực" });
  });
  it.each(["/quantri", "/quantri/tao-tai-khoan", "/quantri/lich-su-dang-nhap", "/quantri/unknown"])("preserves account fallback for %s", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/tai-khoan");
  });
});
