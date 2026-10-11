// Near-synonym check between two skill names, used to flag a suggested skill that looks like a
// skill the career already links ("SQL" / "Truy vấn dữ liệu bằng SQL"). Pure and deliberately
// simple: it only decides whether a review row starts unticked with a hint, never excludes a skill,
// so a false positive costs the admin one tick.
import { fold } from "../shared.js";

/** Folded words that carry no meaning in a skill name ("kỹ năng" is dropped as a phrase, see below). */
const STOPWORDS = new Set(["va", "voi", "bang", "cho", "cua", "trong", "tren"]);
/**
 * Jaccard index from which two token sets count as the same skill. Vietnamese names split into
 * syllables, so siblings such as "Phát triển ứng dụng Android" / "... desktop" (0.67) or
 * "Xây dựng mô hình học máy" / "... học sâu" (0.71) share most tokens without being the same skill.
 */
export const SIMILAR_JACCARD = 0.75;
/** Vietnamese tone marks (huyền, sắc, ngã, hỏi, nặng) after NFD; â/ê/ô/ơ/ư/ă keep their own marks. */
const TONE = /[̣̀́̃̉]/g;

/**
 * Lowercase words of a name, accents kept; # and + stay inside tokens so C#, C++ and C differ.
 * A leading or inner "kỹ năng"/"kĩ năng" and the stopwords are dropped.
 */
export function skillTokens(name: string): Set<string> {
  const words = name.normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}#+]+/u).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const kept = words.filter((word, i) => {
    const folded = fold(word);
    if ((folded === "ky" || folded === "ki") && fold(words[i + 1] ?? "") === "nang") return false;
    if (folded === "nang" && i > 0 && ["ky", "ki"].includes(fold(words[i - 1]!))) return false;
    return !STOPWORDS.has(folded);
  });
  return new Set(kept);
}

/**
 * The tone is part of a Vietnamese syllable ("kê" in "thống kê" is not "kế" in "thiết kế") but its
 * position is not ("hóa" = "hoá"). A word written without any accent matches its accented forms.
 */
function sameToken(left: string, right: string): boolean {
  if (left === right) return true;
  if (/^[\x20-\x7e]*$/.test(left) || /^[\x20-\x7e]*$/.test(right)) return fold(left) === fold(right);
  const key = (word: string) => {
    const decomposed = word.normalize("NFD");
    return decomposed.replace(TONE, "").normalize("NFC") + (decomposed.match(TONE) ?? []).sort().join("");
  };
  return key(left) === key(right);
}

/** True when one name's tokens contain the other's, or the two token sets mostly overlap. */
export function similarSkillNames(left: string, right: string): boolean {
  const a = [...skillTokens(left)];
  const b = [...skillTokens(right)];
  if (!a.length || !b.length) return false;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  const shared = small.filter((token) => large.some((other) => sameToken(token, other))).length;
  if (shared === small.length) return true;
  return shared / (a.length + b.length - shared) >= SIMILAR_JACCARD;
}
