// Helpers purs du bloc Google Sheet : extraire l'id de classeur (+ gid d'onglet)
// d'une URL Google Sheets collée, et construire l'URL d'embed (pubhtml) et
// l'URL d'ouverture (edit). Aucune dépendance — testable isolément.

export interface GoogleSheetRef {
  /** Id du classeur. Soit `<id>` (forme /d/<id>), soit `e/<id>` (forme publiée /d/e/<id>). */
  spreadsheetId: string;
  /** gid de l'onglet ; "0" par défaut quand l'URL n'en porte pas. */
  gid: string;
}

/**
 * Extrait l'id (et le gid si présent) de toutes les formes d'URL Google Sheets :
 *   https://docs.google.com/spreadsheets/d/<ID>/edit#gid=123
 *   https://docs.google.com/spreadsheets/d/<ID>/edit?gid=123
 *   https://docs.google.com/spreadsheets/d/<ID>/pubhtml?gid=123
 *   https://docs.google.com/spreadsheets/d/e/<PUBLISHED_ID>/pubhtml   (forme publiée)
 * Renvoie null si la chaîne n'est pas une URL Sheets reconnaissable.
 */
export function parseGoogleSheetUrl(raw: string): GoogleSheetRef | null {
  const url = (raw ?? "").trim();
  if (!url) return null;
  // /d/e/<id> (publié) ou /d/<id> (normal) — on capture l'un ou l'autre.
  const idMatch = /\/spreadsheets\/d\/(e\/[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/.exec(url);
  if (!idMatch) return null;
  const spreadsheetId = idMatch[1]!;
  // gid dans le hash (#gid=123) ou la query (?gid=123 / &gid=123).
  const gidMatch = /[#?&]gid=([0-9]+)/.exec(url);
  const gid = gidMatch ? gidMatch[1]! : "0";
  return { spreadsheetId, gid };
}

/**
 * Construit l'URL de vue lecture-seule embarquable. Google bloque l'iframe de
 * l'éditeur `/edit` (X-Frame-Options: SAMEORIGIN) ; seule la vue publiée
 * `/pubhtml` s'iframe. `single=true` n'affiche que l'onglet ciblé.
 */
export function buildPubhtmlUrl(ref: GoogleSheetRef): string {
  const params = new URLSearchParams({
    widget: "true",
    headers: "false",
    gid: ref.gid,
    single: "true",
    embedded: "true",
  });
  return `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/pubhtml?${params.toString()}`;
}

/**
 * URL d'ouverture dans Google (bouton « ouvrir »). L'éditeur pour un classeur
 * normal, la vue publiée pour la forme /d/e/<id> (qui n'a pas d'éditeur direct).
 */
export function buildOpenUrl(ref: GoogleSheetRef): string {
  const path = ref.spreadsheetId.startsWith("e/")
    ? `${ref.spreadsheetId}/pubhtml`
    : `${ref.spreadsheetId}/edit`;
  return `https://docs.google.com/spreadsheets/d/${path}#gid=${ref.gid}`;
}
