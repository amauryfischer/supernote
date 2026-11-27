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

/** Les silencieux en clair (« Sami · Léa +2 ») : un « 2/6 » se confondrait avec les compteurs de non-lus. */
function silentNames(silent: EmailAddress[]): string {
  const names = silent.slice(0, 2).map(shortName).join(" · ");
  return silent.length > 2 ? `${names} +${silent.length - 2}` : names;
}

const words = (subject: string) =>
  new Set(
    subject
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !["avec", "pour", "dans", "votre", "notre", "vous", "nous"].includes(w)),
  );

/**
 * Fils de la boîte où un silencieux du tour a écrit depuis la demande, sur un objet apparenté
 * (un mot significatif en commun) : sans cette parenté, un mail sans rapport le ferait passer
 * pour quelqu'un qui a répondu.
 */
export function strayReplies<T extends { id: string; date: string; from: EmailAddress; subject: string }>(
  tour: TourDeTable,
  threadId: string,
  subject: string,
  items: readonly T[],
): T[] {
  const missing = new Set(tour.missing.map((a) => a.email.toLowerCase()));
  const asked = words(subject);
  return items.filter(
    (it) =>
      it.id !== threadId &&
      it.date > tour.askedAt &&
      missing.has(it.from.email.toLowerCase()) &&
      [...words(it.subject)].some((w) => asked.has(w)),
  );
}

/** Marqueur d'une demande dont tous les silencieux ont peut-être répondu ailleurs : à vérifier, pas à relancer. */
export const isUnsureTally = (tally: string) => tally.endsWith("?");

// « v2 » : l'ancien format stockait un décompte « 2/6 ».
const TALLY_KEY = "supernote.mail.subjectTally.v2";

// Lu par chaque ligne de la liste à chaque rendu : on ne reparse que si le texte a changé.
let parsed: { raw: string; value: Record<string, string> } = { raw: "{}", value: {} };

function tallies(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TALLY_KEY) ?? "{}";
    if (raw !== parsed.raw) parsed = { raw, value: JSON.parse(raw) as Record<string, string> };
    return parsed.value;
  } catch {
    return {};
  }
}

/** Texte brut des décomptes : change dès qu'un décompte change, pour invalider les lignes mémoïsées. */
export function subjectTallyStamp(): string {
  tallies();
  return parsed.raw;
}

/** Derniers silencieux connus d'un sujet ou d'un fil : la liste les affiche sans relire les messages. */
export function subjectTally(id: string): string | null {
  return tallies()[id] ?? null;
}

export function rememberSubjectTally(id: string, tour: TourDeTable | null, elsewhere: readonly string[] = []): void {
  const all = { ...tallies() };
  // Ceux qui ont écrit dans un autre fil ne sont pas à relancer : la ligne ne les nomme pas.
  const silent = tour && !tour.open ? tour.missing.filter((a) => !elsewhere.includes(a.email.toLowerCase())) : [];
  if (silent.length > 0) all[id] = silentNames(silent);
  // Une supposition n'efface jamais une demande ouverte : elle reste signalée, à vérifier.
  else if (tour && !tour.open && tour.missing.length > 0) all[id] = `${tour.missing.length} à réunir ?`;
  else delete all[id];
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify(all));
  } catch {
    // Stockage indisponible : la ligne reste sans nom.
  }
}
