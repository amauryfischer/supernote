/**
 * mail-signature — signature de l'utilisateur ajoutée aux messages sortants.
 *
 * Convention RFC 3676 : le séparateur est exactement `-- ` (deux tirets, une
 * espace) sur sa propre ligne. Les clients mail savent replier ce qui suit —
 * et nos propres citations le détectent déjà (cf. `email-quote`).
 *
 * PUR : l'appelant fournit la signature (réglages Gmail).
 */

/** Séparateur de signature normalisé. */
export const SIGNATURE_SEPARATOR = "-- ";

/** Le corps porte-t-il déjà une signature (séparateur présent) ? PUR. */
export function hasSignature(body: string): boolean {
  return body.split(/\r?\n/).some((l) => l === SIGNATURE_SEPARATOR || l === "--");
}

/**
 * Ajoute la signature au corps si elle en a une et qu'aucune n'est déjà là.
 * Renvoie le corps inchangé quand la signature est vide. PUR.
 */
export function withSignature(body: string, signature: string): string {
  const sig = signature.trim();
  if (!sig || hasSignature(body)) return body;
  const base = body.replace(/\s+$/, "");
  return `${base}\n\n${SIGNATURE_SEPARATOR}\n${sig}`;
}

/**
 * Corps initial d'un NOUVEAU message : la signature seule, curseur au-dessus.
 * Renvoie "" sans signature configurée. PUR.
 */
export function initialBodyWithSignature(initial: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return initial;
  return withSignature(initial, sig);
}
