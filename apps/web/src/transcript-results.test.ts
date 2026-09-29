import { describe, expect, it } from "vitest";
import { transcriptResults } from "./transcript-results";

type Attempt = { code: string; result: string | null };
const section = (courses: Attempt[]) => ({ courses });

describe("transcript course results", () => {
  it("normalizes course codes before matching", () => {
    const results = transcriptResults([
      section([{ code: " 71itse30503 ", result: "\u0110\u1ea1t" }]),
    ]);

    expect(results.get("71ITSE30503")).toBe("pass");
    expect(results.size).toBe(1);
  });

  it("recognizes both passed and failed results, including Không đạt", () => {
    const results = transcriptResults([
      section([
        { code: "71ITSE30503", result: "\u0110\u1ea1t" },
        { code: "71ITSE30504", result: "Kh\u00f4ng \u0111\u1ea1t" },
      ]),
    ]);

    expect(results.get("71ITSE30503")).toBe("pass");
    expect(results.get("71ITSE30504")).toBe("fail");
  });

  it("leaves unknown, blank, and missing course results unset", () => {
    const results = transcriptResults([
      section([
        { code: "71ITSE30503", result: "Exempt" },
        { code: "71ITSE30504", result: null },
        { code: "", result: "\u0110\u1ea1t" },
        { code: "   ", result: "Kh\u00f4ng \u0111\u1ea1t" },
      ]),
    ]);

    expect(results.size).toBe(0);
    expect(results.get("71ITSE99999")).toBeUndefined();
  });

  it("keeps a passing attempt when attempts appear fail then pass or pass then fail", () => {
    const results = transcriptResults([
      section([
        { code: "71ITSE30503", result: "Kh\u00f4ng \u0111\u1ea1t" },
        { code: "71ITSE30504", result: "\u0110\u1ea1t" },
      ]),
      section([
        { code: "71ITSE30503", result: "\u0110\u1ea1t" },
        { code: "71ITSE30504", result: "Kh\u00f4ng \u0111\u1ea1t" },
      ]),
    ]);

    expect(results.get("71ITSE30503")).toBe("pass");
    expect(results.get("71ITSE30504")).toBe("pass");
  });
});
