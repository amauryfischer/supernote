// ============================================================
// String stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToNumber, coerceToString } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

// FNV-1a 32-bit hash — no crypto, worker-safe
function fnv1a32(s: string): string {
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

function wordsFrom(s: string): string[] {
  return s.trim().split(/[\s\-_]+/).filter(Boolean);
}

export const stringFunctions: Record<string, (args: Value[]) => Result<Value, EvalError>> = {
  Concat(args) { return ok(args.map(coerceToString).join("")); },
  Concatenate(args) { return ok(args.map(coerceToString).join("")); },
  Length(args) {
    const v = args[0] ?? null;
    if (Array.isArray(v)) return ok(v.length);
    return ok(coerceToString(v).length);
  },
  Len(args) {
    const v = args[0] ?? null;
    if (Array.isArray(v)) return ok(v.length);
    return ok(coerceToString(v).length);
  },
  Upper(args) { return ok(coerceToString(args[0] ?? null).toUpperCase()); },
  Lower(args) { return ok(coerceToString(args[0] ?? null).toLowerCase()); },
  Proper(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  },
  TitleCase(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  },
  Trim(args) { return ok(coerceToString(args[0] ?? null).trim()); },
  Split(args) {
    const s = coerceToString(args[0] ?? null);
    const sep = coerceToString(args[1] ?? ",");
    return ok(s.split(sep));
  },
  Replace(args) {
    const s = coerceToString(args[0] ?? null);
    const from = coerceToString(args[1] ?? null);
    const to = coerceToString(args[2] ?? null);
    return ok(s.split(from).join(to));
  },
  Contains(args) {
    const a = args[0] ?? null;
    const b = args[1] ?? null;
    if (Array.isArray(a)) {
      const targetStr = coerceToString(b);
      return ok(a.some((v) => v === b || coerceToString(v) === targetStr));
    }
    return ok(coerceToString(a).includes(coerceToString(b)));
  },
  ContainsText(args) {
    const s = coerceToString(args[0] ?? null).toLowerCase();
    const sub = coerceToString(args[1] ?? null).toLowerCase();
    return ok(s.includes(sub));
  },
  StartsWith(args) {
    return ok(coerceToString(args[0] ?? null).startsWith(coerceToString(args[1] ?? null)));
  },
  EndsWith(args) {
    return ok(coerceToString(args[0] ?? null).endsWith(coerceToString(args[1] ?? null)));
  },
  StartsWithIgnoreCase(args) {
    return ok(coerceToString(args[0] ?? null).toLowerCase().startsWith(coerceToString(args[1] ?? null).toLowerCase()));
  },
  EndsWithIgnoreCase(args) {
    return ok(coerceToString(args[0] ?? null).toLowerCase().endsWith(coerceToString(args[1] ?? null).toLowerCase()));
  },
  EqualsIgnoreCase(args) {
    return ok(coerceToString(args[0] ?? null).toLowerCase() === coerceToString(args[1] ?? null).toLowerCase());
  },
  FindIgnoreCase(args) {
    const haystack = coerceToString(args[0] ?? null);
    const needle = coerceToString(args[1] ?? null);
    const idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
    return ok(idx < 0 ? 0 : idx + 1);
  },
  Substitute(args) {
    const s = coerceToString(args[0] ?? null);
    const find = coerceToString(args[1] ?? null);
    const replace = coerceToString(args[2] ?? null);
    const occurrence = args.length > 3 ? coerceToNumber(args[3] ?? null) : null;
    if (!find) return ok(s);
    if (occurrence === null || occurrence === undefined) {
      return ok(s.split(find).join(replace));
    }
    const occ = Math.max(1, Math.floor(occurrence));
    let count = 0;
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return ok(s.replace(new RegExp(escaped, "g"), (match) => {
      count++;
      return count === occ ? replace : match;
    }));
  },
  Substring(args) {
    const s = coerceToString(args[0] ?? null);
    const start = coerceToNumber(args[1] ?? null) ?? 0;
    const end = args.length > 2 ? coerceToNumber(args[2] ?? null) ?? s.length : s.length;
    return ok(s.slice(start, end));
  },
  RegexMatch(args) {
    const s = coerceToString(args[0] ?? null);
    const pattern = coerceToString(args[1] ?? null);
    try {
      const match = s.match(new RegExp(pattern));
      return ok(match ? (match[0] ?? null) : null);
    } catch {
      return err(makeEvalError(`RegexMatch: invalid pattern '${pattern}'`));
    }
  },
  RegexReplace(args) {
    const s = coerceToString(args[0] ?? null);
    const pat = coerceToString(args[1] ?? null);
    const rep = coerceToString(args[2] ?? null);
    const flags = args.length > 3 ? coerceToString(args[3] ?? "g") : "g";
    try { return ok(s.replace(new RegExp(pat, flags), rep)); }
    catch { return err(makeEvalError(`RegexReplace: invalid pattern '${pat}'`)); }
  },
  RegexAll(args) {
    const s = coerceToString(args[0] ?? null);
    const pat = coerceToString(args[1] ?? null);
    try {
      const re = new RegExp(pat, "g");
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        out.push(m[0]);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return ok(out);
    } catch { return err(makeEvalError(`RegexAll: invalid pattern '${pat}'`)); }
  },
  Slugify(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  },
  RepeatString(args) {
    const s = coerceToString(args[0] ?? null);
    const n = Math.max(0, Math.floor(coerceToNumber(args[1] ?? null) ?? 0));
    return ok(s.repeat(n));
  },
  Repeat(args) {
    const s = coerceToString(args[0] ?? null);
    const n = Math.max(0, Math.floor(coerceToNumber(args[1] ?? null) ?? 0));
    return ok(s.repeat(n));
  },
  ToText(args) { return ok(coerceToString(args[0] ?? null)); },
  ToNumber(args) { return ok(coerceToNumber(args[0] ?? null)); },
  ParseInt(args) {
    const s = coerceToString(args[0] ?? null);
    const radix = args.length > 1 ? Math.max(2, Math.min(36, coerceToNumber(args[1] ?? null) ?? 10)) : 10;
    const n = parseInt(s, radix);
    return ok(isNaN(n) ? null : n);
  },
  ParseFloat(args) {
    const s = coerceToString(args[0] ?? null);
    const n = parseFloat(s);
    return ok(isNaN(n) ? null : n);
  },
  ParseNumber(args) {
    const s = coerceToString(args[0] ?? null).replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(s);
    return ok(isNaN(n) ? null : n);
  },
  Format(args) {
    if (args.length === 0) return ok("");
    const first = args[0] ?? null;
    if (first instanceof Date) {
      const fmt = coerceToString(args[1] ?? "YYYY-MM-DD");
      const d = first;
      return ok(fmt
        .replace("YYYY", String(d.getFullYear()).padStart(4, "0"))
        .replace("MM", String(d.getMonth() + 1).padStart(2, "0"))
        .replace("DD", String(d.getDate()).padStart(2, "0"))
        .replace("HH", String(d.getHours()).padStart(2, "0"))
        .replace("mm", String(d.getMinutes()).padStart(2, "0"))
        .replace("ss", String(d.getSeconds()).padStart(2, "0")));
    }
    const tpl = coerceToString(first);
    return ok(tpl.replace(/\{(\d+)\}/g, (_, n: string) => {
      const i = Number(n);
      return i >= 1 && i < args.length ? coerceToString(args[i] ?? null) : "";
    }));
  },
  Left(args) {
    const s = coerceToString(args[0] ?? null);
    const n = coerceToNumber(args[1] ?? null) ?? 0;
    return ok(s.slice(0, Math.max(0, n)));
  },
  Right(args) {
    const s = coerceToString(args[0] ?? null);
    const n = coerceToNumber(args[1] ?? null) ?? 0;
    if (n <= 0) return ok("");
    return ok(s.slice(-n));
  },
  Middle(args) {
    const s = coerceToString(args[0] ?? null);
    const start = (coerceToNumber(args[1] ?? null) ?? 1) - 1;
    const len = args.length > 2 ? coerceToNumber(args[2] ?? null) ?? 0 : s.length - start;
    return ok(s.slice(Math.max(0, start), Math.max(0, start) + Math.max(0, len)));
  },
  Find(args) {
    const haystack = coerceToString(args[0] ?? null);
    const needle = coerceToString(args[1] ?? null);
    const from = args.length > 2 ? (coerceToNumber(args[2] ?? null) ?? 1) - 1 : 0;
    const idx = haystack.indexOf(needle, Math.max(0, from));
    return ok(idx < 0 ? 0 : idx + 1);
  },
  Char(args) {
    const code = coerceToNumber(args[0] ?? null);
    if (code === null) return err(makeEvalError("Char: expected number"));
    return ok(String.fromCharCode(Math.floor(code)));
  },
  Code(args) {
    const s = coerceToString(args[0] ?? null);
    if (!s) return err(makeEvalError("Code: expected non-empty string"));
    return ok(s.charCodeAt(0));
  },
  Truncate(args) {
    const s = coerceToString(args[0] ?? null);
    const maxLen = coerceToNumber(args[1] ?? null) ?? 100;
    const suffix = args.length > 2 ? coerceToString(args[2] ?? "…") : "…";
    if (s.length <= maxLen) return ok(s);
    return ok(s.slice(0, maxLen) + suffix);
  },
  Lines(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.split(/\r?\n/));
  },
  LineCount(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.split(/\r?\n/).length);
  },
  Words(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.trim().split(/\s+/).filter(Boolean));
  },
  WordCount(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.trim() === "" ? 0 : s.trim().split(/\s+/).length);
  },
  Sentences(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean));
  },
  StripHtml(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim());
  },
  StripMarkdown(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
      .replace(/[*_~`#>]+/g, "")
      .replace(/\s+/g, " ")
      .trim());
  },
  EscapeHtml(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;"));
  },
  UnescapeHtml(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"));
  },
  EscapeRegex(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  },
  UrlEncode(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(encodeURIComponent(s));
  },
  UrlDecode(args) {
    const s = coerceToString(args[0] ?? null);
    try { return ok(decodeURIComponent(s)); }
    catch { return err(makeEvalError("UrlDecode: invalid encoded string")); }
  },
  Base64Encode(args) {
    const s = coerceToString(args[0] ?? null);
    try {
      return ok(btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, p1: string) => String.fromCharCode(parseInt(p1, 16)))));
    } catch {
      return err(makeEvalError("Base64Encode: encoding failed"));
    }
  },
  Base64Decode(args) {
    const s = coerceToString(args[0] ?? null);
    try {
      return ok(decodeURIComponent(atob(s).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")));
    } catch {
      return err(makeEvalError("Base64Decode: invalid base64"));
    }
  },
  PadStart(args) {
    const s = coerceToString(args[0] ?? null);
    const len = Math.floor(coerceToNumber(args[1] ?? null) ?? 0);
    const ch = args.length > 2 ? coerceToString(args[2] ?? " ") : " ";
    return ok(s.padStart(len, ch));
  },
  PadEnd(args) {
    const s = coerceToString(args[0] ?? null);
    const len = Math.floor(coerceToNumber(args[1] ?? null) ?? 0);
    const ch = args.length > 2 ? coerceToString(args[2] ?? " ") : " ";
    return ok(s.padEnd(len, ch));
  },
  CamelCase(args) {
    const words = wordsFrom(coerceToString(args[0] ?? null));
    return ok(words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""));
  },
  KebabCase(args) {
    return ok(wordsFrom(coerceToString(args[0] ?? null)).map((w) => w.toLowerCase()).join("-"));
  },
  SnakeCase(args) {
    return ok(wordsFrom(coerceToString(args[0] ?? null)).map((w) => w.toLowerCase()).join("_"));
  },
  PascalCase(args) {
    return ok(wordsFrom(coerceToString(args[0] ?? null)).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""));
  },
  LeftOf(args) {
    const s = coerceToString(args[0] ?? null);
    const sep = coerceToString(args[1] ?? null);
    const idx = s.indexOf(sep);
    return ok(idx < 0 ? s : s.slice(0, idx));
  },
  RightOf(args) {
    const s = coerceToString(args[0] ?? null);
    const sep = coerceToString(args[1] ?? null);
    const idx = s.indexOf(sep);
    return ok(idx < 0 ? "" : s.slice(idx + sep.length));
  },
  Between(args) {
    const s = coerceToString(args[0] ?? null);
    const start = coerceToString(args[1] ?? null);
    const end = coerceToString(args[2] ?? null);
    const si = s.indexOf(start);
    if (si < 0) return ok("");
    const after = si + start.length;
    const ei = s.indexOf(end, after);
    return ok(ei < 0 ? "" : s.slice(after, ei));
  },
  Pluralize(args) {
    const word = coerceToString(args[0] ?? null);
    const n = coerceToNumber(args[1] ?? null) ?? 0;
    return ok(n === 1 ? word : word + "s");
  },
  Hash(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(fnv1a32(s));
  },
  Reverse(args) {
    const v = args[0] ?? null;
    if (Array.isArray(v)) return ok([...v].reverse());
    return ok(coerceToString(v).split("").reverse().join(""));
  },
};
