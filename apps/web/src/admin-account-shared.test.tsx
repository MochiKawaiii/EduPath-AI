import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreateAccount } from "./admin-account-shared";

describe("create account form", () => {
  const html = renderToStaticMarkup(<CreateAccount onList={() => undefined} />);

  it("uses the same form style as the other admin dialogs", () => {
    expect(html).toContain('<form class="cm-form"');
    expect(html).toContain('<label class="cm-check">');
    expect(html).toContain('<div class="cm-actions cm-dialog-actions">');
    expect(html).not.toMatch(/am-field|am-confirm|am-form-actions|am-quiet/);
  });

  it("marks the required field and names the actions like the other dialogs", () => {
    expect(html).toContain('<span class="am-required" aria-hidden="true">*</span>');
    expect(html).toMatch(/<button class="am-outline" type="button">.*Hủy<\/button>/);
    expect(html).toMatch(/<button class="am-primary" type="submit">.*Tạo tài khoản quản trị<\/button>/);
  });
});
