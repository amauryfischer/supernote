// ============================================================
// Nettoyage du markdown pour les libellés d'extraction
// ============================================================

/**
 * Retire la syntaxe markdown d'un fragment destiné à être AFFICHÉ (chip,
 * titre de tâche). Les libellés d'interface ne doivent jamais porter de `##`,
 * de `**` ni de `[[…]]`.
 */
export function stripMarkdownInline(input: string): string {
  let out = input ?? "";
  out = out.replace(/^\s{0,3}#{1,6}\s*/, "");
  out = out.replace(/^\s*>+\s*/, "");
  out = out.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
  out = out.replace(/^\s*\[[ xX]\]\s*/, "");
  out = out.replace(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1");
  out = out.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  out = out.replace(/`{1,3}([^`]*)`{1,3}/g, "$1");
  for (let i = 0; i < 2; i++) {
    out = out.replace(/(\*\*\*|___|\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/g, "$2");
  }
  return out.replace(/\s+/g, " ").trim();
}

const ACCENT_MAP: Record<string, string> = {
  à: "a", á: "a", â: "a", ã: "a", ä: "a", å: "a",
  ç: "c",
  è: "e", é: "e", ê: "e", ë: "e",
  ì: "i", í: "i", î: "i", ï: "i",
  ñ: "n",
  ò: "o", ó: "o", ô: "o", õ: "o", ö: "o",
  ù: "u", ú: "u", û: "u", ü: "u",
  ý: "y", ÿ: "y",
  œ: "oe", æ: "ae",
};

/**
 * Minuscules + accents retirés, SANS changer la longueur de la chaîne : les
 * règles d'échéance renvoient des index qui servent ensuite à découper le
 * texte d'origine. `œ`/`æ` sont volontairement laissés tels quels ici (ils
 * changeraient la longueur) — cf. `foldForIndex`.
 */
export function foldForIndex(input: string): string | null {
  let out = "";
  for (const ch of input.toLowerCase()) {
    const mapped = ACCENT_MAP[ch];
    out += mapped !== undefined && mapped.length === 1 ? mapped : ch;
  }
  return out.length === input.length ? out : null;
}

/** Comparaison insensible casse/accents/ponctuation finale/espaces. */
export function normalizeForCompare(input: string): string {
  let out = (input ?? "").toLowerCase();
  for (const [from, to] of Object.entries(ACCENT_MAP)) {
    out = out.split(from).join(to);
  }
  return out
    .replace(/[.!?;:,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isHeadingLine(line: string): boolean {
  return /^\s{0,3}#{1,6}\s/.test(line);
}

/** Texte de tous les titres du document, normalisé pour comparaison. */
export function headingTexts(source: string): Set<string> {
  const out = new Set<string>();
  for (const line of (source ?? "").split("\n")) {
    if (!isHeadingLine(line)) continue;
    const text = normalizeForCompare(stripMarkdownInline(line));
    if (text) out.add(text);
  }
  return out;
}
