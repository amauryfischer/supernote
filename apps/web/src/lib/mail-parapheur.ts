/**
 * Parapheur — le mail découpé en questions et en promesses, par règles fixes.
 *
 * Deux lectures, sans IA (donc identiques sur téléphone) :
 *  - les QUESTIONS du dernier message reçu, copiées mot pour mot, auxquelles on
 *    répond d'une touche (« grille ») : chaque réponse s'écrit dans le corps sous
 *    la question citée entre guillemets — le corps reste la seule vérité, une
 *    question est « tranchée » quand sa citation y porte une réponse ;
 *  - les PROMESSES datées de MA réponse (« je t'envoie le contrat vendredi »),
 *    repérées pendant la frappe : au moment d'écrire, l'auteur et la fermeté sont
 *    certains, là où l'extraction IA après coup se trompait de sens.
 *
 * Tout ce qui est affiché est une sous-chaîne du texte : rien n'est deviné.
 */

import { findFrenchDeadline } from "@supernote/ai/extract";
import type { CalEventRow } from "@supernote/ipc";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { parseEmailBody } from "@/lib/email-quote";
import { detectDateTime } from "@/lib/email-to-event";
import { isFirmPromise, loadThreadCommitments, saveThreadCommitments, type Commitment } from "@/lib/mail-commitments";

// ─── Découpage en phrases ────────────────────────────────────────────────────

const BULLET = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+/;

/**
 * Phrases d'un texte brut : paragraphes recollés (un mail est souvent coupé à
 * 72 colonnes), puces gardées à part, coupe après « . ! ? … ».
 */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const units: string[] = [];
    for (const line of para.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (BULLET.test(t) || units.length === 0) units.push(t.replace(BULLET, ""));
      else units[units.length - 1] += ` ${t}`;
    }
    for (const unit of units) {
      for (const s of unit.split(/(?<=[?!.…])\s+/)) {
        const clean = s.replace(/\s+/g, " ").trim();
        if (clean) out.push(clean);
      }
    }
  }
  return out;
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// ─── Questions du message reçu ───────────────────────────────────────────────

const MAX_QUESTIONS = 8;
const GREETING_PREFIX = /^(?:bonjour|bonsoir|salut|hello|coucou|re)\b[^,?!]{0,40},\s*/i;
/** Demandes sans point d'interrogation, en tête de phrase. */
const REQUEST_START =
  /^(?:(?:merci de|je (?:te|vous) remercie de|je (?:te|vous) laisse)\s+(?:me\s+|m['’]|nous\s+)?(?:confirmer|valider|indiquer|dire|envoyer|transmettre|faire|retourner|pr[ée]ciser|communiquer|revenir|savoir)|(?:dis|dites)-moi\b)/i;
/** Politesse : jamais une décision à prendre. */
const SMALL_TALK =
  /^(?:comment (?:vas-tu|allez-vous|[çc]a va|tu vas|vous allez)|[çc]a va|tu vas bien|vous allez bien|bien (?:arriv|rentr)|des questions|une question|n'h[ée]site)/i;

/**
 * Questions et demandes du texte NEUF d'un message (citation et signature
 * retirées), dans l'ordre, sans doublon. La formule d'appel qui précède une
 * question (« Bonjour Paul, tu es dispo jeudi ? ») est retirée.
 */
export function extractQuestions(raw: string): string[] {
  const { body } = parseEmailBody(raw);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sentences(body)) {
    const q = s.replace(GREETING_PREFIX, "");
    const isQuestion = /\?\s*[)»"']*$/.test(q);
    if (!isQuestion && !REQUEST_START.test(q)) continue;
    if (SMALL_TALK.test(q)) continue;
    const words = q.match(/[a-zà-ÿ0-9]+/gi) ?? [];
    if (words.length < 2 || q.length < 8) continue;
    const key = norm(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

/** Tutoiement si le message tutoie plus qu'il ne vouvoie ; vouvoiement à égalité. */
export function addressForm(raw: string): "tu" | "vous" {
  const t = ` ${norm(parseEmailBody(raw).body)} `;
  const vous = (t.match(/[^a-zà-ÿ](?:vous|votre|vos)(?=[^a-zà-ÿ])/g) ?? []).length;
  const tu = (t.match(/[^a-zà-ÿ](?:(?:tu|te|toi|ton|ta|tes)(?=[^a-zà-ÿ])|t')/g) ?? []).length;
  return tu > vous ? "tu" : "vous";
}

// ─── Réponses dans le corps ──────────────────────────────────────────────────

/** Citation d'une question dans la réponse : guillemets français, seule sur sa ligne. */
export const questionMarker = (q: string): string => `« ${q} »`;

const isMarkerLine = (line: string): boolean => /^«\s.+\s»$/.test(line.trim());
const OPENING = /^(?:bonjour|bonsoir|salut|hello|coucou|cher|ch[èe]re|madame|monsieur)\b/i;

/** Réponse écrite sous la citation de `q` (jusqu'à la ligne vide suivante), `null` si la question n'est pas citée. */
export function answerOf(body: string, q: string): string | null {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => l.trim() === questionMarker(q));
  if (at < 0) return null;
  const answer: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() === "" || isMarkerLine(l)) break;
    answer.push(l);
  }
  return answer.join("\n").trim();
}

export const isAnswered = (body: string, q: string): boolean => Boolean(answerOf(body, q));

/**
 * Écrit `answer` sous la question `index` : remplace une réponse déjà donnée,
 * sinon insère le bloc à sa place dans l'ordre des questions (après la formule
 * d'appel si le texte en commence par une). Renvoie aussi la position du curseur
 * à la fin de la réponse. Pur.
 */
export function placeAnswer(
  body: string,
  questions: readonly string[],
  index: number,
  answer: string,
): { body: string; cursor: number } {
  const q = questions[index];
  if (q === undefined) return { body, cursor: body.length };
  // Le texte existant est tassé d'abord : une réponse vide (« écrire ») garde sa ligne à remplir.
  let lines = body.replace(/\s+$/, "").replace(/\n{3,}/g, "\n\n").split("\n");
  if (lines.length === 1 && lines[0] === "") lines = [];
  const markerAt = (x: string) => lines.findIndex((l) => l.trim() === questionMarker(x));
  const blockEnd = (start: number) => {
    let i = start + 1;
    while (i < lines.length && lines[i]!.trim() !== "" && !isMarkerLine(lines[i]!)) i++;
    return i;
  };
  const answerLines = answer.split("\n");
  const block = [questionMarker(q), ...answerLines];
  const own = markerAt(q);
  if (own >= 0) {
    lines.splice(own + 1, blockEnd(own) - own - 1, ...answerLines);
  } else {
    const later = questions.slice(index + 1).map(markerAt).find((i) => i >= 0);
    const earlier = questions.slice(0, index).map(markerAt).filter((i) => i >= 0);
    if (later !== undefined) {
      lines.splice(later, 0, ...block, "");
    } else if (earlier.length > 0) {
      lines.splice(blockEnd(Math.max(...earlier)), 0, "", ...block);
    } else {
      const head = lines.length > 0 && OPENING.test(lines[0]!.trim()) ? lines.slice(0, 1) : [];
      const tail = lines.slice(head.length);
      while (tail.length > 0 && tail[0]!.trim() === "") tail.shift();
      lines = [...head, ...(head.length ? [""] : []), ...block, ...(tail.length ? ["", ...tail] : [])];
    }
  }
  const next = lines.join("\n");
  const at = next.indexOf(questionMarker(q));
  return { body: next, cursor: at + questionMarker(q).length + 1 + answer.length };
}

// ─── Réponses toutes faites ──────────────────────────────────────────────────

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}

/**
 * « Je reviens vers vous là-dessus d'ici vendredi. » — deux jours ouvrés. La
 * phrase est elle-même une promesse datée : le Parapheur la reconnaît ensuite.
 */
export function laterAnswer(form: "tu" | "vous", now: Date = new Date()): string {
  const day = WEEKDAYS[addBusinessDays(now, 2).getDay()]!;
  return `Je reviens vers ${form === "tu" ? "toi" : "vous"} là-dessus d'ici ${day}.`;
}

const DATE_QUESTION =
  /\b(?:dispo|disponibles?|disponibilit[ée]s?|quand|date|cr[ée]neaux?|rendez-vous|rdv|r[ée]union|rencontrer|se voir|appel|appeler|visio|call|caler|planifier)\b/i;

/** La question appelle-t-elle une date ? (pour proposer des créneaux libres) */
export const isDateQuestion = (q: string): boolean => DATE_QUESTION.test(q);

/** Heures essayées, dans l'ordre de préférence (créneaux d'une heure). */
const SLOT_HOURS = [10, 11, 14, 15, 16, 9, 17];
const SLOT_MS = 3_600_000;

/**
 * Premier créneau d'une heure libre de chacun des prochains jours ouvrés (dès
 * demain), d'après l'agenda local. Un événement sur la journée entière, annulé
 * ou décliné ne bloque pas.
 */
export function freeSlots(events: readonly CalEventRow[], now: Date = new Date(), count = 3): Date[] {
  const busy = events
    .filter((e) => !e.allDay && e.status !== "cancelled" && e.selfResponse !== "declined")
    .map((e) => [e.startAt, e.endAt] as const);
  const out: Date[] = [];
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let guard = 0; out.length < count && guard < 21; guard++) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    for (const h of SLOT_HOURS) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime();
      if (!busy.some(([s, e]) => s < start + SLOT_MS && e > start)) {
        out.push(new Date(start));
        break;
      }
    }
  }
  return out;
}

/** « jeu. 27 · 10:00 » */
export function slotLabel(d: Date): string {
  const wd = WEEKDAYS[d.getDay()]!.slice(0, 3);
  return `${wd}. ${d.getDate()} · ${String(d.getHours()).padStart(2, "0")}:00`;
}

/** « Je vous propose jeudi 27 novembre à 10 h. » */
export function slotAnswer(d: Date, form: "tu" | "vous"): string {
  return `Je ${form === "tu" ? "te" : "vous"} propose ${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} à ${d.getHours()} h.`;
}

// ─── Promesses de ma réponse ─────────────────────────────────────────────────

export interface DraftPromise {
  /** Clé stable : la phrase normalisée. */
  key: string;
  /** Phrase telle qu'écrite. */
  quote: string;
  /** Échéance `YYYY-MM-DD`. */
  due: string;
}

const MAX_PROMISES = 3;
/** Au-delà, c'est un numéro (« version 1.5 ») plus qu'une échéance. */
const MAX_HORIZON_DAYS = 120;
/** « je / j' / on / nous » en SUJET : en tête de phrase ou de proposition (« il nous envoie » n'est pas à moi). */
const FIRST_PERSON =
  /(?:^|[,;:]\s*|(?:^|\s)(?:et|mais|donc|alors|puis|sinon|ensuite|oui|ok|parfait|bien|merci)\s+)(?:je\s|j['’][a-zà-ÿ]|on\s|nous\s)/i;
/** Passé, état, opinion : pas un engagement à faire. */
const NOT_AN_ACT =
  /(?:^|[^a-zà-ÿ])(?:j['’](?:ai|avais|[ée]tais|esp[èe]re)|nous avons|on a|je (?:suis|pense|crois|trouve|sais|ne sais|serai absent|(?:te |vous )?(?:propose|remercie|souhaite|demande))|nous sommes|on est)(?![a-zà-ÿ])/i;
/** Négation : « je ne pourrai pas jeudi » n'engage à rien. */
const NEGATION = /(?:^|[^a-zà-ÿ])(?:ne|n['’])\s?[a-zà-ÿ]+.*\b(?:pas|plus|jamais|rien)\b/i;

function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Échéance d'une phrase, aujourd'hui ou plus tard ; `null` si elle n'en donne pas. */
function deadlineOf(sentence: string, now: Date): string | null {
  const today = isoDay(now);
  const horizon = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + MAX_HORIZON_DAYS));
  const plausible = (iso: string | null | undefined): iso is string => !!iso && iso >= today && iso <= horizon;
  const fr = findFrenchDeadline(sentence, now)?.iso;
  if (plausible(fr)) return fr;
  const d = detectDateTime(sentence, now);
  const iso = d ? isoDay(d) : null;
  return plausible(iso) ? iso : null;
}

/**
 * Promesses fermes et datées que J'écris : sujet à la première personne, action
 * à venir, échéance lisible. Ignore les citations (`>`), les questions reprises
 * entre guillemets et les phrases interrogatives. Pur (hors `now`).
 */
export function findPromises(body: string, now: Date = new Date()): DraftPromise[] {
  const mine = body
    .split("\n")
    .filter((l) => !/^\s*>/.test(l) && !isMarkerLine(l))
    .join("\n");
  const out: DraftPromise[] = [];
  const seen = new Set<string>();
  for (const s of sentences(mine)) {
    if (s.endsWith("?") || !FIRST_PERSON.test(s) || NOT_AN_ACT.test(s) || NEGATION.test(s)) continue;
    if (!isFirmPromise(s)) continue;
    const due = deadlineOf(s, now);
    if (!due) continue;
    const key = norm(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, quote: s, due });
    if (out.length >= MAX_PROMISES) break;
  }
  return out;
}

/** « ven. 28 nov. » */
export function dueLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

// ─── Suivi : tâche datée + engagement « je dois » ────────────────────────────

export interface FollowTarget {
  accountId: string;
  threadId: string;
  subject: string;
  who: { name: string; email: string };
}

export interface FollowedPromises {
  todoIds: string[];
  keys: string[];
}

const commitmentKey = (p: DraftPromise) => `pp_${p.key.replace(/[^a-z0-9]+/g, "_").slice(0, 60)}_${p.due}`;

/**
 * Chaque promesse suivie devient une tâche datée (rappel à 9 h le jour dit) liée
 * au fil, et un engagement « je dois » accepté : il apparaît dans « Aujourd'hui »
 * comme ceux que l'on accepte depuis le bandeau, avec la phrase exacte en source.
 */
export async function followPromises(target: FollowTarget, promises: readonly DraftPromise[]): Promise<FollowedPromises> {
  const todoIds: string[] = [];
  const items: Commitment[] = [];
  const who = target.who.name || target.who.email;
  for (const p of promises) {
    const text = p.quote.replace(/[.!…\s]+$/, "");
    const created = await trpcVanillaClient.entities.create.mutate({
      typeId: TODO_TYPE_ID,
      fields: {
        text,
        done: false,
        priority: 5,
        importance: "medium",
        urgent: false,
        dueDate: p.due,
        reminderAt: new Date(`${p.due}T09:00:00`).toISOString(),
        reminderText: text,
        mailThreadId: target.threadId,
        mailFromName: who,
        mailFromEmail: target.who.email,
        mailSnippet: p.quote,
      },
    });
    todoIds.push(created.id);
    items.push({
      key: commitmentKey(p),
      direction: "moi",
      who,
      whoEmail: target.who.email,
      text,
      due: p.due,
      quote: p.quote,
      messageId: "",
      status: "accepted",
      todoId: created.id,
    });
  }
  const keys = items.map((i) => i.key);
  try {
    const latest = await loadThreadCommitments(target.accountId, target.threadId);
    await saveThreadCommitments({
      accountId: target.accountId,
      threadId: target.threadId,
      subject: latest?.subject || target.subject,
      fingerprint: latest?.fingerprint ?? "",
      items: [...(latest?.items ?? []).filter((c) => !keys.includes(c.key)), ...items],
    });
  } catch {
    // La tâche datée est la trace qui compte ; l'engagement n'en est qu'un reflet.
  }
  return { todoIds, keys };
}

/** Envoi annulé à temps : la promesse n'a pas été faite, ses traces disparaissent. */
export async function unfollowPromises(target: FollowTarget, followed: FollowedPromises): Promise<void> {
  await Promise.allSettled(followed.todoIds.map((id) => trpcVanillaClient.entities.delete.mutate({ id })));
  try {
    const latest = await loadThreadCommitments(target.accountId, target.threadId);
    if (!latest) return;
    await saveThreadCommitments({ ...latest, items: latest.items.filter((c) => !followed.keys.includes(c.key)) });
  } catch {
    // Rien à retirer.
  }
}
