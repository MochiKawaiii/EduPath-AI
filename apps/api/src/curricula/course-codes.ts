import { z } from "zod";

// Codes are identifiers supplied by a curriculum, not a fixed institution format.
// Keep the existing canonical casing for catalog and prerequisite comparisons.
export const courseCode = z.string().trim().toUpperCase()
  .min(1, "Mã học phần không được để trống.")
  .max(100, "Mã học phần không được vượt quá 100 ký tự.")
  .refine((code) => !/[\u0000-\u001f\u007f-\u009f]/.test(code), "Mã học phần không được chứa ký tự điều khiển.");

export function referencedCourseCodes(raw: string, knownCodes: Iterable<string>): string[] {
  const text = raw.toUpperCase();
  const matches: { code: string; index: number }[] = [];
  const brackets: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/\[([^\[\]\r\n]+)\]/g)) {
    const parsed = courseCode.safeParse(match[1]);
    brackets.push({ start: match.index!, end: match.index! + match[0].length });
    if (parsed.success) matches.push({ code: parsed.data, index: match.index! });
  }
  const overlaps = (index: number, length: number) =>
    brackets.some((range) => index < range.end && index + length > range.start) ||
    matches.some((match) => index < match.index + match.code.length && index + length > match.index);
  // Match known identifiers literally (including punctuation or spaces). Do not
  // infer their length, numeric prefix or letter count from an old code template.
  for (const code of [...knownCodes].sort((a, b) => b.length - a.length)) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_.\\/+@#&=-])(${escaped})(?=$|[^\\p{L}\\p{N}_.\\/+@#&=-]|[.!?](?=$|\\s))`, "gu");
    for (const match of text.matchAll(pattern)) {
      const index = match.index! + match[1]!.length;
      if (!overlaps(index, code.length)) matches.push({ code, index });
    }
  }
  // Retain unbracketed alphanumeric references outside the current curriculum
  // for review, including deleted/renamed codes. Arbitrary identifiers can always
  // be referenced unambiguously using [code], even when they contain spaces.
  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}_.\/-]*/gu)) {
    const token = match[0].replace(/[.,;:]+$/, "");
    const parsed = courseCode.safeParse(token);
    if (parsed.success && /\p{L}/u.test(token) && /\p{N}/u.test(token) && !overlaps(match.index!, token.length)) {
      matches.push({ code: parsed.data, index: match.index! });
    }
  }
  const standalone = courseCode.safeParse(text);
  if (!matches.length && standalone.success && !/\s|\[|\]/.test(standalone.data)) matches.push({ code: standalone.data, index: 0 });
  return [...new Set(matches.sort((a, b) => a.index - b.index).map((match) => match.code))];
}
