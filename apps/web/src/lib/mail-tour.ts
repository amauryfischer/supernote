import type { EmailAddress, EmailThread } from "@/lib/gmail";

export interface TourDeTable {
  /** Destinataires de ma demande, dans l'ordre d'écriture. */
  asked: EmailAddress[];
  answered: EmailAddress[];
  missing: EmailAddress[];
  /** Date ISO de la demande. */
  askedAt: string;
}

const key = (a: EmailAddress) => a.email.trim().toLowerCase();

/**
 * Qui a répondu à une demande que j'ai adressée à plusieurs personnes.
 * La demande est mon premier message à au moins deux destinataires : quelqu'un qui a écrit
 * avant elle n'y a pas répondu. `cc` n'est pas relu depuis le miroir, seul `to` compte.
 * `null` s'il n'y a pas de telle demande.
 */
export function tourDeTable(threads: readonly EmailThread[], selfEmails: readonly string[]): TourDeTable | null {
  const self = new Set(selfEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const messages = threads.flatMap((t) => t.messages).filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
  const others = (list: EmailAddress[]) => list.filter((a) => a.email && !self.has(key(a)));
  const anchorAt = messages.findIndex((m) => self.has(key(m.from)) && others(m.to).length >= 2);
  if (anchorAt < 0) return null;

  const asked = new Map<string, EmailAddress>();
  const answeredKeys = new Set<string>();
  for (const m of messages.slice(anchorAt)) {
    if (!self.has(key(m.from))) {
      answeredKeys.add(key(m.from));
      continue;
    }
    for (const a of others(m.to)) if (!asked.has(key(a))) asked.set(key(a), a);
  }
  const list = [...asked.values()];
  return {
    asked: list,
    answered: list.filter((a) => answeredKeys.has(key(a))),
    missing: list.filter((a) => !answeredKeys.has(key(a))),
    askedAt: messages[anchorAt]!.date,
  };
}

/** Prénom affichable : le nom s'il existe, sinon la partie locale de l'adresse. */
export function shortName(a: EmailAddress): string {
  const base = a.name.trim() && a.name.trim().toLowerCase() !== key(a) ? a.name.trim() : (a.email.split("@")[0] ?? "").replace(/[._-]+/g, " ");
  const first = base.split(/\s+/)[0] ?? base;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
