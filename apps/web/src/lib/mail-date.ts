/**
 * Formatage des dates d'e-mail pour les listes (vue groupée + groupe ouvert).
 * But QoL : repérer la RÉCENCE d'un coup d'œil — un mail d'aujourd'hui montre
 * son HEURE (et non « 26 juin »), pour identifier facilement le dernier reçu.
 *
 * `now` injectable → pur & testable (sinon `new Date()` au runtime).
 */

function timePart(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function datePart(d: Date, now: Date): string {
  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })
    : d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/**
 * Format COMPACT relatif (en-têtes de groupe / lignes simples de l'overlay) :
 *  - aujourd'hui → heure (`14:32`) — fait ressortir la récence ;
 *  - hier        → `hier` ;
 *  - cette année → `26 juin` ;
 *  - plus ancien → `26/06/24`.
 * `""` pour une date vide/invalide.
 */
export function formatMailDate(iso: string, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isSameDay(d, now)) return timePart(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, yesterday)) return "hier";
  return datePart(d, now);
}

/**
 * Format AVEC heure (lignes d'un groupe ouvert, où l'on compare des mails entre
 * eux → l'heure aide à les ordonner) :
 *  - aujourd'hui → `14:32` ;
 *  - autre jour  → `26 juin, 14:32` (ou `26/06/24, 14:32` hors année courante).
 * `""` pour une date vide/invalide.
 */
export function formatMailDateTime(iso: string, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isSameDay(d, now)) return timePart(d);
  return `${datePart(d, now)}, ${timePart(d)}`;
}
