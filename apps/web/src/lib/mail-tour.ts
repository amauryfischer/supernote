import type { EmailAddress, EmailThread } from "@/lib/gmail";

export interface TourDeTable {
  /** Destinataires de ma demande, dans l'ordre d'écriture. */
  asked: EmailAddress[];
  answered: EmailAddress[];
  missing: EmailAddress[];
  /** Date ISO de la demande. */
  askedAt: string;
  /** Fil qui porte la demande : une relance y reste, sinon ses réponses échapperaient au compte. */
  threadId: string;
  /** Aucune demande écrite retrouvée : seules les voix entendues sont connues, personne ne « manque ». */
  open?: boolean;
}

/** Préfixe des labels Gmail qui réunissent plusieurs fils en un sujet. */
export const SUBJECT_PREFIX = "Sujet/";

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
  if (anchorAt < 0) {
    if (threads.length < 2) return null;
    const voices = new Map<string, EmailAddress>();
    for (const m of messages) if (!self.has(key(m.from)) && !voices.has(key(m.from))) voices.set(key(m.from), m.from);
    if (voices.size < 2) return null;
    const list = [...voices.values()];
    return { asked: list, answered: list, missing: [], askedAt: messages[0]!.date, threadId: "", open: true };
  }

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
    threadId: messages[anchorAt]!.threadId,
  };
}

/** Prénom affichable : le nom s'il existe, sinon la partie locale de l'adresse. */
export function shortName(a: EmailAddress): string {
  const base = a.name.trim() && a.name.trim().toLowerCase() !== key(a) ? a.name.trim() : (a.email.split("@")[0] ?? "").replace(/[._-]+/g, " ");
  const first = base.split(/\s+/)[0] ?? base;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

const TALLY_KEY = "supernote.mail.subjectTally";

function tallies(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TALLY_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** Dernier décompte connu d'un sujet ou d'un fil (« 4/6 ») : la liste l'affiche sans relire les messages. */
export function subjectTally(id: string): string | null {
  return tallies()[id] ?? null;
}

export function rememberSubjectTally(labelId: string, tour: TourDeTable | null): void {
  const all = tallies();
  // Tour bouclé : plus rien à suivre, la ligne redevient ordinaire.
  if (tour && !tour.open && tour.missing.length > 0) all[labelId] = `${tour.answered.length}/${tour.asked.length}`;
  else delete all[labelId];
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify(all));
  } catch {
    // Stockage indisponible : la liste retombe sur « ×N ».
  }
}
