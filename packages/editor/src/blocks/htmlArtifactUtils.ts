// Logique pure du bloc htmlArtifact — séparée du .tsx pour que la
// sérialisation markdown puisse l'importer sans tirer React
// (même découpage que googleSheetUrl.ts / gmailEmbedUrl.ts).

export const HTML_ARTIFACT_DEFAULT_HEIGHT = 420;
export const HTML_ARTIFACT_MIN_HEIGHT = 160;
export const HTML_ARTIFACT_MAX_HEIGHT = 2000;

export function clampHtmlHeight(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return HTML_ARTIFACT_DEFAULT_HEIGHT;
  return Math.min(HTML_ARTIFACT_MAX_HEIGHT, Math.max(HTML_ARTIFACT_MIN_HEIGHT, Math.round(n)));
}

/**
 * Vrai pour un document HTML complet (doctype, <html>, ou fragment structuré
 * fermé) — le critère qui distingue « j'ai copié le code d'un artefact » de
 * « j'ai copié un bout de page web » (ce dernier arrive en text/html et doit
 * rester du texte riche).
 */
export function looksLikeHtmlDocument(text: string): boolean {
  const trimmed = text.trim();
  const head = trimmed.slice(0, 2000).toLowerCase();
  if (head.startsWith("<!doctype html")) return true;
  if (head.startsWith("<html")) return true;
  return (
    /^<(body|head|main|section|div)\b/.test(head) &&
    /<\/(body|html|main|section|div)>$/i.test(trimmed)
  );
}

/**
 * Fence markdown pour un contenu donné : au moins 3 backticks, et toujours un
 * de plus que la plus longue suite présente dans le contenu (un artefact qui
 * contient ``` ne doit pas clôturer son propre bloc).
 */
export function fenceFor(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}
