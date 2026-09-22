import { describe, expect, it } from "vitest";
import { adminNavigation, resolveAdminPage } from "./admin-navigation";
describe("admin section navigation", () => {
  it("has account, student-profile, curriculum, graduation, training-plan, and career sections", () => {
    expect(adminNavigation.map(item => item.path)).toEqual(["/quantri/tai-khoan", "/quantri/sinh-vien", "/quantri/chuong-trinh", "/quantri/tieu-chuan-tot-nghiep", "/quantri/ke-hoach", "/quantri/vi-tri-nghe-nghiep"]);
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
  it.each(["/quantri", "/quantri/tao-tai-khoan", "/quantri/lich-su-dang-nhap", "/quantri/unknown"])("preserves account fallback for %s", path => {
    expect(resolveAdminPage(path).path).toBe("/quantri/tai-khoan");
  });
});
