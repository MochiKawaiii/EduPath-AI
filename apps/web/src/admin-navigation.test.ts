import { describe, expect, it } from "vitest";
import { adminNavigation, resolveAdminPage } from "./admin-navigation";
describe("admin section navigation", () => {
  it("has account, student-profile, curriculum, graduation, training-plan, career, career-field, skill and competency sections", () => {
    expect(adminNavigation.map(item => item.path)).toEqual(["/quantri/tai-khoan", "/quantri/sinh-vien", "/quantri/chuong-trinh", "/quantri/tieu-chuan-tot-nghiep", "/quantri/ke-hoach", "/quantri/vi-tri-nghe-nghiep", "/quantri/linh-vuc-nghe-nghiep", "/quantri/ky-nang", "/quantri/danh-gia-nang-luc"]);
  });
  it.each(["/quantri/sinh-vien", "/quantri/sinh-vien/"])("resolves direct student link %s", path => {
    expect(resolveAdminPage(path).label).toBe("Hồ sơ sinh viên");
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
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/linh-vuc-nghe-nghiep", label: "Lĩnh vực nghề nghiệp", breadcrumb: "Lĩnh vực nghề nghiệp" });
  });
  it.each(["/quantri/ky-nang", "/quantri/ky-nang/"])("resolves direct skill link %s", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/ky-nang", label: "Danh sách kỹ năng", breadcrumb: "Danh sách kỹ năng" });
  });
  it.each(["/quantri/danh-gia-nang-luc", "/quantri/danh-gia-nang-luc/"])("resolves direct competency link %s", path => {
    expect(resolveAdminPage(path)).toMatchObject({ path: "/quantri/danh-gia-nang-luc", label: "Đánh giá năng lực", breadcrumb: "Đánh giá năng lực" });
  });
  it.each(["/quantri", "/quantri/tao-tai-khoan", "/quantri/lich-su-dang-nhap", "/quantri/unknown"])("preserves account fallback for %s", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/tai-khoan");
  });
});
