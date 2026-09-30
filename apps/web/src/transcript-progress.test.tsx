import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TranscriptProgress from "./TranscriptProgress";
import { advanceImportProgress } from "./transcript-progress";

describe("transcript import progress", () => {
  it.each([
    ["uploading", 18],
    ["queued", 28],
    ["processing", 95],
  ] as const)("advances monotonically and stops at the %s estimate cap", (stage, ceiling) => {
    let progress = advanceImportProgress(0, stage);
    let prior = progress;
    for (let index = 0; index < 500; index += 1) {
      progress = advanceImportProgress(progress, stage);
      expect(progress).toBeGreaterThanOrEqual(prior);
      expect(progress).toBeLessThanOrEqual(ceiling);
      prior = progress;
    }
    expect(progress).toBe(ceiling);
  });

  it("never moves backward as the job advances through stages", () => {
    const uploading = advanceImportProgress(8, "uploading");
    const queued = advanceImportProgress(uploading, "queued");
    const processing = advanceImportProgress(queued, "processing");
    const completed = advanceImportProgress(processing, "completed", false);

    expect(queued).toBeGreaterThanOrEqual(uploading);
    expect(processing).toBeGreaterThanOrEqual(queued);
    expect(completed).toBe(100);
  });

  it("pauses queued and processing estimates while offline", () => {
    expect(advanceImportProgress(23, "queued", false)).toBe(23);
    expect(advanceImportProgress(61, "processing", false)).toBe(61);
    expect(advanceImportProgress(2, "uploading", false)).toBeGreaterThan(2);
  });

  it("renders an accessible estimate and a distinct 100 percent completed state", () => {
    const waiting = renderToStaticMarkup(
      createElement(TranscriptProgress, { stage: "processing", workerOnline: false }),
    );
    expect(waiting).toContain('role="progressbar"');
    expect(waiting).toContain('aria-valuenow="30"');
    expect(waiting).toContain('aria-valuetext="30% ước lượng');
    expect(waiting).toContain("is-waiting");

    const completed = renderToStaticMarkup(
      createElement(TranscriptProgress, { stage: "completed", workerOnline: false }),
    );
    expect(completed).toContain('aria-valuenow="100"');
    expect(completed).toContain('class="sr-progress-track is-completed"');
    expect(completed).not.toContain("ước lượng</small>");
  });
});
