import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FaqAnswer from "./FaqAnswer";
import {
  competencyPolicyCategoryId,
  competencyPolicyHref,
  frequentlyAskedQuestions,
  informationPolicies,
  policyUpdatedAt,
  policyVersion,
  publicInformationLinks,
  supportEmail
} from "./public-information";

const policyBlocks = Object.values(informationPolicies).flatMap((policy) =>
  policy.categories.flatMap((category) => category.sections.flatMap((section) => [section.title, ...section.paragraphs.flat()])));
const faqBlocks = frequentlyAskedQuestions.flatMap((faq) => [faq.question, ...faq.answer, ...(faq.steps ?? []), ...(faq.note ? [faq.note] : [])]);
const competencyCategory = informationPolicies.privacy.categories.find((category) => category.id === competencyPolicyCategoryId);
const competencyText = competencyCategory?.sections.flatMap((section) => section.paragraphs.flat()).join(" ") ?? "";

describe("public policy, terms and FAQ", () => {
  it("shows the consent policy version as the update date", () => {
    expect(policyVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(policyUpdatedAt).toBe(policyVersion.split("-").reverse().join("/"));
  });

  it("links competency consent to a privacy category the policy page renders", () => {
    expect(competencyPolicyHref).toBe(`${publicInformationLinks[0].href}#bao-mat-${competencyPolicyCategoryId}`);
    expect(competencyCategory?.label).toBe("Đánh giá năng lực và AI");
  });

  it("explains what the local AI model receives, what it never receives and how long results are kept", () => {
    expect(competencyText).toContain("Gemma 4 E4B");
    expect(competencyText).toContain("chạy cục bộ");
    expect(competencyText).toContain("không nhận họ tên, mã số sinh viên, email, lớp");
    expect(competencyText).toContain("dịch vụ AI đám mây");
    expect(competencyText).toContain("tối đa 20 lần đánh giá gần nhất");
    expect(competencyText).toContain("rút lại sự đồng ý");
  });

  it("no longer says EduPath does not use AI or will announce AI features before they launch", () => {
    for (const text of [...policyBlocks, ...faqBlocks]) {
      expect(text).not.toMatch(/chưa dùng AI|chưa sử dụng AI|được đưa vào sử dụng|thông báo trước khi áp dụng/);
    }
  });

  it("keeps the existing policy anchors", () => {
    expect(informationPolicies.privacy.categories.map((category) => category.id)).toEqual(
      expect.arrayContaining(["tong-quan", "thong-tin", "muc-dich", "bang-diem", "chia-se", "luu-tru", "quyen-cua-ban", "lien-he"]));
    expect(informationPolicies.terms.categories.map((category) => category.id)).toEqual(
      ["gioi-thieu", "tai-khoan", "bang-diem", "quy-tac", "ket-qua", "dich-vu", "vi-pham"]);
  });

  it("keeps category ids, section titles and FAQ questions unique", () => {
    for (const policy of Object.values(informationPolicies)) {
      const ids = policy.categories.map((category) => category.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const category of policy.categories) {
        const titles = category.sections.map((section) => section.title);
        expect(new Set(titles).size).toBe(titles.length);
      }
    }
    const questions = frequentlyAskedQuestions.map((faq) => faq.question);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("stays plain text", () => {
    for (const text of [...policyBlocks, ...faqBlocks]) expect(text).not.toMatch(/\*\*|`|\]\(|<\/?[a-z]/);
  });

  it("renders the support e-mail in FAQ answers as a link", () => {
    const faq = frequentlyAskedQuestions.find((item) => item.note?.includes(supportEmail));
    expect(faq).toBeDefined();
    expect(renderToStaticMarkup(createElement(FaqAnswer, { faq: faq! }))).toContain(`<a href="mailto:${supportEmail}">${supportEmail}</a>`);
  });
});
