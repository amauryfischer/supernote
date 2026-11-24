import { trpcVanillaClient } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import type { EmailMessage, EmailThread } from "@/lib/gmail";
import { isSelfAddress, runLocalPrompt } from "@/lib/mail-ai";
import { detectDateTime } from "@/lib/email-to-event";
import { addFollowup, inDaysAt9 } from "@/lib/mail-followup";
import { djb2 } from "@/lib/todos/extractChecklists";

/** Doit rester égal à `MAIL_COMMITMENT_TYPE_ID` du seed worker (non importable côté client). */
export const MAIL_COMMITMENT_TYPE_ID = "mail_commitment";
export const COMMITMENTS_ENABLED_KEY = "supernote.ai.commitments";
export const MAIL_COMMITMENTS_EVENT = "supernote:mail-commitments";

export type CommitmentDirection = "moi" | "eux";
export type CommitmentStatus = "suggested" | "accepted" | "dismissed";

export interface Commitment {
  key: string;
  direction: CommitmentDirection;
  who: string;
  whoEmail: string;
  text: string;
  due: string | null;
  quote: string;
  messageId: string;
  status: CommitmentStatus;
  todoId?: string;
}

export type DetectedCommitment = Omit<Commitment, "status" | "todoId">;

export interface ThreadCommitments {
  accountId: string;
  threadId: string;
  subject: string;
  fingerprint: string;
  items: Commitment[];
}

const MAX_MESSAGES = 8;
const MAX_BODY_CHARS = 1_500;
// En dessous, ce sont des acquiescements (« ok merci »), pas des promesses.
const MIN_QUOTE_CHARS = 12;
// Conditionnel, souhait, simple possibilité, politesse : pas une promesse ferme. Mesuré sur 12 vrais fils (2026-11-24) :
// retire 3 faux engagements sur 6 sans en perdre un vrai. « je pourrai » (futur) reste une promesse, « je pourrais » non.
const NOT_FIRM =
  /(^|[\s,;:(«"'])(si (vous|tu|besoin|n[ée]cessaire|possible|jamais|cela|ça)|je (peux|pourrais)(?![a-zé])|nous (pouvons|pourrions)|on (peut|pourrait)(?![a-zé])|j'aimerais|je (souhaite(rais)?|voudrais)|il faudrait|l'id[ée]e serait|[ée]ventuellement|à (votre|ta) disposition|n'h[ée]site)/i;
export const isFirmPromise = (quote: string): boolean => !NOT_FIRM.test(quote);
console.assert(isFirmPromise("Je pourrai vous envoyer le devis lundi") && !isFirmPromise("Si tu veux, je regarde demain") && !isFirmPromise("Je pourrais passer jeudi"));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[«»“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

export function commitmentsEnabled(): boolean {
  try {
    return window.localStorage.getItem(COMMITMENTS_ENABLED_KEY) !== "0";
  } catch {
    return false;
  }
}

/** Même calcul côté runner (snippet de threads.list) et côté fil ouvert (snippet du dernier message). */
export function threadFingerprint(snippet: string): string {
  return djb2(norm(snippet));
}

export function isStale(tc: ThreadCommitments | undefined, fingerprint: string): boolean {
  return !tc || tc.fingerprint !== fingerprint;
}

function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function recentMessages(thread: EmailThread): EmailMessage[] {
  return thread.messages.slice(-MAX_MESSAGES);
}

const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

// Un message à la fois, et seulement « que promet SON auteur ? » : sur 12 vrais fils (2026-11-24), le fil entier
// en une question trouvait 3 promesses sur 8, cette forme 6 sur 8, sans échéance inventée.
const MAX_EXAMPLES = 4;
const MAX_EXAMPLE_CHARS = 160;

interface DecidedExamples {
  accepted: string[];
  dismissed: string[];
}

/** Ce que l'utilisateur a déjà confirmé ou écarté : ses tournures et celles de ses correspondants servent d'exemples au modèle. */
async function loadDecidedExamples(): Promise<DecidedExamples> {
  const out: DecidedExamples = { accepted: [], dismissed: [] };
  try {
    const res = await trpcVanillaClient.entities.list.query({ typeId: MAIL_COMMITMENT_TYPE_ID, limit: 1000 });
    for (const e of res.items) {
      for (const c of fromEntity(e)?.items ?? []) {
        if (c.status === "suggested") continue;
        const bucket = c.status === "accepted" ? out.accepted : out.dismissed;
        const quote = c.quote.replace(/\s+/g, " ").trim().slice(0, MAX_EXAMPLE_CHARS);
        if (!bucket.includes(quote)) bucket.push(quote);
      }
    }
  } catch {
    return { accepted: [], dismissed: [] };
  }
  // Les dernières décisions reflètent le mieux le goût actuel.
  return { accepted: out.accepted.slice(-MAX_EXAMPLES), dismissed: out.dismissed.slice(-MAX_EXAMPLES) };
}

function examplesBlock(ex: DecidedExamples): string[] {
  const list = (quotes: string[]) => quotes.map((q) => `- « ${q} »`);
  return [
    ...(ex.accepted.length ? ["L'utilisateur a déjà confirmé comme vraies promesses des phrases de ce genre :", ...list(ex.accepted)] : []),
    ...(ex.dismissed.length ? ["Il a écarté des phrases de ce genre, ne relève rien de semblable :", ...list(ex.dismissed)] : []),
  ];
}

function buildPrompt(m: EmailMessage, selfEmails: readonly string[], examples: DecidedExamples): string {
  const author = isSelfAddress(m.from.email, selfEmails) ? "Moi" : m.from.name || m.from.email;
  const sent = m.date ? new Date(m.date) : null;
  const when = sent && !Number.isNaN(sent.getTime()) ? `, envoyé le ${DAYS[sent.getDay()]} ${isoDay(sent)}` : "";
  return [
    `Tu lis UN email écrit par ${author}${when}.`,
    "Relève uniquement les phrases où L'AUTEUR s'engage à faire LUI-MÊME quelque chose plus tard.",
    "Exemples à relever : « je vous envoie le devis vendredi », « je regarde ça », « je m'en occupe », « on vous rappelle lundi », « je te fais un retour demain ».",
    "Ne relève PAS :",
    "- ce que l'auteur demande à quelqu'un d'autre (« pouvez-vous… », « merci de… », « il faudrait que tu… », « peux-tu… ») ;",
    "- ce qui est déjà fait (« j'ai envoyé », « c'est fait », « ci-joint ») ;",
    "- les formules de politesse (« je reste à disposition », « n'hésitez pas », « je reviens vers vous ») ;",
    "- les questions, les hypothèses (« si…, je pourrais »), les constats.",
    "Test pour chaque phrase : son sujet est-il l'auteur (je, nous, on) ET annonce-t-elle une action à venir ? Sinon, ne la relève pas.",
    ...examplesBlock(examples),
    'Réponds UNIQUEMENT en JSON : {"engagements": [{"quote": "...", "text": "...", "due": "AAAA-MM-JJ" | null}]}.',
    "- quote : la phrase copiée mot pour mot depuis l'email.",
    "- text : l'action, courte, à l'infinitif.",
    "- due : seulement si la phrase donne une échéance, calculée à partir de la date d'envoi ; sinon null.",
    'Aucun engagement : {"engagements": []}.',
    "",
    "Email :",
    (m.bodyText || m.snippet).slice(0, MAX_BODY_CHARS),
  ].join("\n");
}

interface RawCommitment {
  text?: unknown;
  due?: unknown;
  quote?: unknown;
}

function parseRaw(raw: string): RawCommitment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    parsed = (parsed as Record<string, unknown>)["engagements"];
  }
  return Array.isArray(parsed)
    ? parsed.filter((x): x is RawCommitment => typeof x === "object" && x !== null)
    : [];
}

/** `seen` est partagé entre les messages d'un fil : une promesse recitée dans l'historique d'une réponse n'est comptée qu'une fois. */
function validate(raw: RawCommitment[], msg: EmailMessage, selfEmails: readonly string[], seen: Set<string>): DetectedCommitment[] {
  const out: DetectedCommitment[] = [];
  for (const r of raw) {
    const text = typeof r.text === "string" ? r.text.trim() : "";
    const quote = typeof r.quote === "string" ? r.quote.trim() : "";
    if (!text || quote.length < MIN_QUOTE_CHARS || !isFirmPromise(quote)) continue;

    // Anti-hallucination : la citation doit exister telle quelle dans ce message.
    if (!norm(msg.bodyText || msg.snippet).includes(norm(quote))) continue;

    // Le sens vient de l'expéditeur réel, pas du modèle.
    const mine = isSelfAddress(msg.from.email, selfEmails);
    const counterpart = mine ? (msg.to[0] ?? { name: "", email: "" }) : msg.from;

    const sent = msg.date ? new Date(msg.date) : new Date();
    let due = typeof r.due === "string" && ISO_DAY.test(r.due) && !Number.isNaN(Date.parse(r.due)) ? r.due : null;
    if (due && due < isoDay(sent)) due = null;
    if (!due) {
      const detected = detectDateTime(quote, sent);
      if (detected && isoDay(detected) >= isoDay(sent)) due = isoDay(detected);
    }

    if (seen.has(norm(quote))) continue;
    seen.add(norm(quote));
    const key = djb2(`${msg.id}|${norm(quote)}`);
    out.push({
      key,
      direction: mine ? "moi" : "eux",
      who: counterpart.name || counterpart.email,
      whoEmail: counterpart.email,
      text,
      due,
      quote,
      messageId: msg.id,
    });
  }
  return out;
}

export async function analyzeThread(thread: EmailThread, selfEmails: readonly string[]): Promise<DetectedCommitment[]> {
  if (thread.messages.length === 0) return [];
  const seen = new Set<string>();
  const out: DetectedCommitment[] = [];
  const examples = await loadDecidedExamples();
  // Du plus ancien au plus récent : le message d'origine d'une promesse passe avant ceux qui le citent.
  for (const m of recentMessages(thread)) {
    if (!(m.bodyText || m.snippet).trim()) continue;
    const raw = await runLocalPrompt(buildPrompt(m, selfEmails, examples), 0.1, "json");
    out.push(...validate(parseRaw(raw), m, selfEmails, seen));
  }
  return out;
}

/** Une décision de l'utilisateur survit aux réanalyses ; une suggestion non traitée suit la dernière passe. */
export function mergeCommitments(previous: Commitment[], fresh: DetectedCommitment[]): Commitment[] {
  const byKey = new Map(previous.map((c) => [c.key, c]));
  const decided = previous.filter((c) => c.status !== "suggested");
  // Le modèle ne recopie pas toujours la même portion de phrase : une citation qui recoupe une décision n'est pas neuve.
  const overlapsDecided = (f: DetectedCommitment) =>
    !byKey.has(f.key) &&
    decided.some(
      (d) => d.messageId === f.messageId && (norm(d.quote).includes(norm(f.quote)) || norm(f.quote).includes(norm(d.quote))),
    );
  const merged: Commitment[] = fresh.filter((f) => !overlapsDecided(f)).map((f) => {
    const old = byKey.get(f.key);
    return old && old.status !== "suggested" ? old : { ...f, status: "suggested" };
  });
  const freshKeys = new Set(fresh.map((f) => f.key));
  for (const old of previous) {
    if (!freshKeys.has(old.key) && old.status !== "suggested") merged.push(old);
  }
  return merged;
}

function isCommitment(v: unknown): v is Commitment {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["key"] === "string" &&
    (o["direction"] === "moi" || o["direction"] === "eux") &&
    typeof o["text"] === "string" &&
    (o["status"] === "suggested" || o["status"] === "accepted" || o["status"] === "dismissed")
  );
}

export function fromEntity(e: { fields?: Record<string, unknown> }): ThreadCommitments | null {
  const f = e.fields ?? {};
  const threadId = f["mc_thread_id"];
  const accountId = f["mc_account_email"];
  if (typeof threadId !== "string" || typeof accountId !== "string") return null;
  let items: Commitment[] = [];
  try {
    const parsed: unknown = JSON.parse(typeof f["mc_items"] === "string" ? f["mc_items"] : "[]");
    if (Array.isArray(parsed)) items = parsed.filter(isCommitment);
  } catch {
    items = [];
  }
  return {
    accountId,
    threadId,
    subject: typeof f["mc_subject"] === "string" ? f["mc_subject"] : "",
    fingerprint: typeof f["mc_fp"] === "string" ? f["mc_fp"] : "",
    items,
  };
}

function entityIdOf(accountId: string, threadId: string): string {
  return `mc_${accountId.replace(/[^a-zA-Z0-9]/g, "_")}_${threadId}`;
}

/** Relecture juste avant d'écrire : une analyse dure plusieurs secondes, l'état affiché a pu changer entre-temps. */
export async function loadThreadCommitments(accountId: string, threadId: string): Promise<ThreadCommitments | undefined> {
  try {
    return fromEntity(await trpcVanillaClient.entities.get.query({ id: entityIdOf(accountId, threadId) })) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Analyse fusionnée avec l'état le plus récent, pas avec celui du rendu. */
export async function analyzeAndSave(
  thread: EmailThread,
  accountId: string,
  selfEmails: readonly string[],
  fingerprint: string,
): Promise<void> {
  const fresh = await analyzeThread(thread, selfEmails);
  const latest = await loadThreadCommitments(accountId, thread.id);
  await saveThreadCommitments({
    accountId,
    threadId: thread.id,
    subject: thread.messages[0]?.subject ?? "",
    fingerprint,
    items: mergeCommitments(latest?.items ?? [], fresh),
  });
}

export async function saveThreadCommitments(tc: ThreadCommitments): Promise<void> {
  await trpcVanillaClient.mail.setCommitments.mutate({
    accountId: tc.accountId,
    threadId: tc.threadId,
    subject: tc.subject,
    items: JSON.stringify(tc.items),
    fingerprint: tc.fingerprint,
  });
  window.dispatchEvent(new CustomEvent(MAIL_COMMITMENTS_EVENT));
}

function withItem(tc: ThreadCommitments, key: string, patch: Partial<Commitment>): ThreadCommitments {
  return { ...tc, items: tc.items.map((c) => (c.key === key ? { ...c, ...patch } : c)) };
}

function at9(day: string): string {
  return new Date(`${day}T09:00:00`).toISOString();
}

/**
 * « Je dois » → todo datée liée au fil ; « On me doit » → relance le lendemain de l'échéance.
 * `messageCount` = taille actuelle du fil : la relance s'efface si quelqu'un répond d'ici là.
 */
export async function acceptCommitment(shown: ThreadCommitments, key: string, messageCount: number): Promise<void> {
  const tc = (await loadThreadCommitments(shown.accountId, shown.threadId)) ?? shown;
  const c = tc.items.find((x) => x.key === key);
  if (!c || c.status !== "suggested") return;
  if (c.direction === "moi") {
    const created = await trpcVanillaClient.entities.create.mutate({
      typeId: TODO_TYPE_ID,
      fields: {
        text: c.text,
        done: false,
        priority: 5,
        importance: "medium",
        urgent: false,
        ...(c.due ? { dueDate: c.due, reminderAt: at9(c.due), reminderText: c.text } : {}),
        mailThreadId: tc.threadId,
        mailFromName: c.who,
        mailFromEmail: c.whoEmail,
        mailSnippet: c.quote,
      },
    });
    await saveThreadCommitments(withItem(tc, key, { status: "accepted", todoId: created.id }));
    return;
  }
  const dueAt = c.due ? new Date(`${c.due}T09:00:00`).getTime() + 86_400_000 : inDaysAt9(3);
  addFollowup({ threadId: tc.threadId, subject: tc.subject, messageCount, dueAt });
  await saveThreadCommitments(withItem(tc, key, { status: "accepted" }));
}

export async function dismissCommitment(shown: ThreadCommitments, key: string): Promise<void> {
  const tc = (await loadThreadCommitments(shown.accountId, shown.threadId)) ?? shown;
  await saveThreadCommitments(withItem(tc, key, { status: "dismissed" }));
}

export function followUpDraft(c: Commitment): string {
  const first = c.who.split(/\s+/)[0] ?? "";
  return `Bonjour ${first},\n\nJe me permets de revenir vers vous au sujet de : ${c.text.charAt(0).toLowerCase()}${c.text.slice(1)}.\n\nBien à vous`;
}
