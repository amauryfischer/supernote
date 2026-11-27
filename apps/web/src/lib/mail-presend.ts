import type { EmailAddress } from "@/lib/gmail";
import { parseEmailBody } from "@/lib/email-quote";

const ATTACHMENT_HINT =
  /\b(ci[- ]joint(e|es|s)?|en pi[eè]ces? jointes?|pi[eè]ces? jointes?|je (te |vous )?joins|vous trouverez joint|attached|attachment)\b|\bPJ\b/i;

// Expéditeurs automatiques (« Google Calendar », « Service Client ») : leur « prénom » est un mot courant.
const AUTOMATED = /^(no-?reply|ne-?pas-?repondre|notifications?|calendar-notification|info|contact|support|hello|bonjour|news(letter)?|marketing|mailer-daemon|team|service)\b/i;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Oublis courants avant d'envoyer, sur le seul texte tapé (citation et signature écartées) :
 * une pièce jointe annoncée mais absente, une personne connue citée par son prénom sans
 * être destinataire. Des avertissements : l'envoi reste possible en confirmant.
 */
export function presendWarnings({
  text,
  attachmentCount,
  recipients,
  people,
  selfEmails,
}: {
  text: string;
  attachmentCount: number;
  recipients: readonly string[];
  people: readonly EmailAddress[];
  selfEmails: readonly string[];
}): string[] {
  const typed = parseEmailBody(text).body;
  const out: string[] = [];
  if (attachmentCount === 0 && ATTACHMENT_HINT.test(typed)) {
    out.push("Tu annonces une pièce jointe, mais aucune n'est jointe.");
  }

  const sent = new Set(recipients.map((r) => r.trim().toLowerCase()));
  const self = new Set(selfEmails.map((e) => e.toLowerCase()));
  const firstName = (p: EmailAddress) => fold(p.name.trim().split(/\s+/)[0] ?? "");
  // Un prénom porté par un destinataire est couvert, même si un homonyme manque.
  const covered = new Set(people.filter((p) => sent.has(p.email.toLowerCase())).map(firstName));
  const byFirst = new Map<string, EmailAddress>();
  for (const p of people) {
    const f = firstName(p);
    // Un nom d'un seul mot (« Support », « Facturation ») n'est pas un prénom fiable.
    if (f.length < 3 || p.name.trim().split(/\s+/).length < 2 || self.has(p.email.toLowerCase())) continue;
    if (AUTOMATED.test(p.email.split("@")[0] ?? "")) continue;
    if (!byFirst.has(f)) byFirst.set(f, p);
  }
  const missing = new Map<string, { word: string; person: EmailAddress }>();
  for (const word of typed.match(/\p{Lu}[\p{Ll}'’-]+/gu) ?? []) {
    const f = fold(word);
    const person = byFirst.get(f);
    if (person && !covered.has(f) && !missing.has(f)) missing.set(f, { word, person });
  }
  for (const { word, person } of [...missing.values()].slice(0, 3)) {
    out.push(`Tu cites ${word} : ${person.name} (${person.email}) n'est pas destinataire.`);
  }
  return out;
}
