/**
 * Logique pure de collecte des destinataires email (compose « à un groupe »).
 *
 * - `pickContactEmail` : choisit UNE adresse pour un contact (préfère le label
 *   "pro", sinon la première non vide).
 * - `dedupeEmails` : dé-duplique une liste d'adresses (insensible à la casse),
 *   conserve la première occurrence, retire les vides.
 * - `parseRecipientInput` : découpe une saisie libre ("," ";" retours ligne) en
 *   destinataires. NE coupe PAS sur les espaces (un token peut être un nom
 *   affiché « Nom Prénom <a@b.com> »).
 *
 * Sans dépendance React/IPC → testable isolément.
 */

export interface RecipientEmail {
  value: string;
  /** "pro" | "perso" | "autre" côté contacts ; typé large pour réutilisation. */
  label?: string;
}

/** Choisit l'email d'un contact : préfère le label "pro", sinon le premier non vide. */
export function pickContactEmail(emails: RecipientEmail[] | undefined): string | null {
  if (!emails || emails.length === 0) return null;
  const valid = emails.filter(
    (e) => e && typeof e.value === "string" && e.value.trim().length > 0,
  );
  if (valid.length === 0) return null;
  const pro = valid.find((e) => e.label === "pro");
  return (pro ?? valid[0]!).value.trim();
}

/**
 * Dé-duplique des adresses (insensible à la casse), conserve la 1ʳᵉ occurrence
 * (casse d'origine), retire les vides après trim.
 */
export function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const v = raw.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * Découpe une saisie manuelle en destinataires. Sépare UNIQUEMENT sur les
 * virgules, points-virgules et retours ligne — PAS sur les espaces : un token
 * peut être un destinataire au format display-name « Nom Prénom <a@b.com> »,
 * conservé tel quel.
 */
export function parseRecipientInput(input: string): string[] {
  return input
    .split(/[,;\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
