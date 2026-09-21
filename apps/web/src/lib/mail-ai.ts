/**
 * mail-ai — surcouche IA *locale* (Ollama) pour la boîte mail.
 *
 * Réutilise l'infra IA existante du projet (AUCUN SDK cloud) :
 *   - `createOllamaClient` (@supernote/ai) construit comme dans `ChatPanel.tsx`,
 *   - `getAiSettings()` (@/lib/ai/settings) pour { baseUrl, model },
 *   - le RAG note (`@/lib/rag` + embeddings stockés sur `entity.fields.embedding`,
 *     même source que `@/lib/rag-indexer`) pour le contexte de brouillon.
 *
 * Découpage volontaire :
 *   - Les `buildXxxPrompt(...)` sont des fonctions PURES et déterministes
 *     (sérialisation du fil en texte BRUT, jamais de HTML) → testables sans réseau.
 *   - Les appels (`summarizeThread`, `draftReply`, `suggestQuadrant`,
 *     `extractActions`, `retrieveNotesForThread`) ont des effets de bord (Ollama,
 *     coffre) et lèvent une erreur CLAIRE si Ollama est injoignable — l'UI catch
 *     et affiche un toast (pas de crash).
 *
 * Garde de configuration : `isAiConfigured()` gate l'exposition des features IA.
 */

import { createOllamaClient } from "@supernote/ai";
import { getAiSettings } from "@/lib/ai/settings";
import {
  embedQuery,
  cosineSimilarity,
  parseEmbeddingField,
  DEFAULT_EMBED_MODEL,
} from "@/lib/rag";
import { OLLAMA_HOST_KEY, DEFAULT_OLLAMA_HOST } from "@/hooks/useAutoTitle";
import { trpcVanillaClient } from "@/lib/trpc/client";
import type { EntitySummary } from "@supernote/ipc";
import type { EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import type { EmailThread } from "@/lib/gmail";

// ── Forme minimale d'un fil acceptée par les builders ───────────────────────
// On ne dépend PAS de `EmailThread` complet pour garder les builders purs et
// testables avec des fixtures légères. Tout ce dont les prompts ont besoin :
// l'expéditeur, le sujet, le corps texte (bodyText — jamais HTML) et la date.

export interface MailAiAddress {
  name: string;
  email: string;
}

export interface MailAiMessage {
  subject: string;
  from: MailAiAddress;
  /** Destinataires directs : distinguent une note à moi-même d'un email envoyé. */
  to?: MailAiAddress[];
  date: string;
  /** Corps text/plain (JAMAIS de HTML injecté dans le prompt). */
  bodyText: string;
}

export interface MailAiThread {
  id: string;
  messages: MailAiMessage[];
  /** Adresses « à moi » (compte connecté + alias) : leurs messages sont marqués « Moi ». */
  selfEmails?: readonly string[];
}

/**
 * Adaptateur EmailThread → MailAiThread : QUE du texte brut dans le prompt
 * (bodyText/snippet, jamais le HTML de l'expéditeur → pas d'injection).
 */
export function toMailAiThread(thread: EmailThread, selfEmails: readonly string[]): MailAiThread {
  return {
    id: thread.id,
    selfEmails,
    messages: thread.messages.map((m) => ({
      subject: m.subject,
      from: { name: m.from.name, email: m.from.email },
      to: m.to.map((a) => ({ name: a.name, email: a.email })),
      date: m.date,
      bodyText: m.bodyText || m.snippet || "",
    })),
  };
}

// ── Constantes de sérialisation ─────────────────────────────────────────────

/** Longueur max d'un corps de message injecté dans un prompt (par message). */
const MAX_BODY_CHARS = 1_500;
/** Nombre max de messages du fil sérialisés (on garde les plus récents). */
const MAX_MESSAGES = 12;
/** Nombre de notes de contexte RAG ramenées pour un brouillon. */
const MAX_CONTEXT_NOTES = 3;
/** Longueur max d'un extrait de note de contexte. */
const MAX_NOTE_CHARS = 800;
/** Seuil de similarité cosinus minimal pour retenir une note de contexte. */
const MIN_NOTE_SIMILARITY = 0.3;

// ── Gate de configuration ───────────────────────────────────────────────────

/**
 * Vrai si l'IA locale est configurée (baseUrl + model non vides). L'UI gate
 * l'affichage des features IA dessus : pas de configuration → pas de boutons IA.
 */
export function isAiConfigured(): boolean {
  const { baseUrl, model } = getAiSettings();
  return Boolean(baseUrl && baseUrl.trim() && model && model.trim());
}

// ── Helpers de sérialisation (purs) ─────────────────────────────────────────

/** Adresse appartenant à l'utilisateur (insensible à la casse, vides ignorés). PUR. */
export function isSelfAddress(email: string, selfEmails: readonly string[] | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return !!e && (selfEmails ?? []).some((s) => s.trim().toLowerCase() === e);
}

/** Fil dont chaque message va de moi à moi seul : un pense-bête. PUR. */
export function isNoteToSelf(
  messages: readonly { from: MailAiAddress; to?: readonly MailAiAddress[] }[],
  selfEmails: readonly string[] | undefined,
): boolean {
  return (
    messages.length > 0 &&
    messages.every((m) => {
      const to = m.to ?? [];
      return (
        isSelfAddress(m.from.email, selfEmails) &&
        to.length > 0 &&
        to.every((a) => isSelfAddress(a.email, selfEmails))
      );
    })
  );
}

/** Affiche une adresse : "Nom <email>", l'un des deux, ou « Moi (…) ». */
function formatSender(from: MailAiAddress, selfEmails?: readonly string[]): string {
  const name = from.name?.trim();
  const email = from.email?.trim();
  const label = name && email ? `${name} <${email}>` : name || email || "(expéditeur inconnu)";
  return isSelfAddress(email, selfEmails) ? `Moi (${label})` : label;
}

/**
 * Sans cette ligne, un petit modèle lit chaque message comme reçu et résume mes
 * propres envois (ou mes notes à moi-même) comme des demandes qu'on me fait.
 */
function selfPerspective(thread: MailAiThread): string | null {
  if (isNoteToSelf(thread.messages, thread.selfEmails)) {
    return "Je suis l'utilisateur. Ce fil est une note que je me suis envoyée à moi-même : un pense-bête, pas un email reçu.";
  }
  if (thread.messages.some((m) => isSelfAddress(m.from.email, thread.selfEmails))) {
    return "Je suis l'utilisateur : les messages « De : Moi » sont les miens, les autres viennent de mes correspondants.";
  }
  return null;
}

/** Tronque un texte en ajoutant un marqueur explicite si coupé. PUR. */
function truncate(text: string, max: number): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

/**
 * Sérialise un fil en texte BRUT (jamais de HTML). Garde au plus `MAX_MESSAGES`
 * messages les plus récents, chaque corps tronqué à `MAX_BODY_CHARS`. PUR &
 * déterministe — c'est le cœur testé des builders de prompt.
 */
export function serializeThread(thread: MailAiThread): string {
  const msgs = thread.messages.slice(-MAX_MESSAGES);
  const body = msgs
    .map((m, i) => {
      const lines = [
        `--- Message ${i + 1} ---`,
        `De : ${formatSender(m.from, thread.selfEmails)}`,
      ];
      if (m.to && m.to.length > 0) {
        lines.push(`À : ${m.to.map((a) => formatSender(a, thread.selfEmails)).join(", ")}`);
      }
      lines.push(`Objet : ${m.subject?.trim() || "(sans objet)"}`);
      if (m.date?.trim()) lines.push(`Date : ${m.date.trim()}`);
      lines.push("", truncate(m.bodyText, MAX_BODY_CHARS));
      return lines.join("\n");
    })
    .join("\n\n");
  const perspective = selfPerspective(thread);
  return perspective ? `${perspective}\n\n${body}` : body;
}

/** Sujet du fil = sujet du premier message (fallback explicite). PUR. */
export function threadSubject(thread: MailAiThread): string {
  return thread.messages[0]?.subject?.trim() || "(sans objet)";
}

// ── Builders de prompt (PURS, testés) ───────────────────────────────────────

/**
 * Prompt de résumé d'un fil. Demande un résumé concis en français + les points
 * d'action. Déterministe : sérialise le fil tel quel. PUR.
 */
export function buildSummaryPrompt(thread: MailAiThread): string {
  return [
    "Tu es un assistant qui résume des fils d'emails en français.",
    "Résume le fil de discussion ci-dessous de façon concise (5 lignes max).",
    "Mentionne les décisions prises et les éventuelles actions attendues.",
    "Ne mentionne PAS d'information absente du fil. Réponds en français.",
    "",
    `Objet du fil : ${threadSubject(thread)}`,
    "",
    "Fil de discussion :",
    serializeThread(thread),
  ].join("\n");
}

export interface BuildReplyPromptOptions {
  /** Extraits de notes du coffre à utiliser comme contexte (texte brut). */
  contextNotes?: string[];
  /** Consigne libre de l'utilisateur (ton, contenu attendu…). */
  instruction?: string;
  /**
   * Destinataire visé (« Nom <email> »). Quand notre organisation (associés/
   * collègues) et un tiers échangent, on répond AU TIERS, pas à nos collègues :
   * leurs messages restent du contexte. Absent → réponse au dernier message.
   */
  recipient?: string;
}

/**
 * Prompt de génération d'un brouillon de réponse. Intègre optionnellement des
 * notes de contexte (RAG) et une consigne utilisateur. PUR & déterministe.
 */
export function buildReplyPrompt(
  thread: MailAiThread,
  opts: BuildReplyPromptOptions = {},
): string {
  const lines: string[] = [
    "Tu es un assistant qui rédige des brouillons de réponse à des emails, en français.",
    "Rédige une réponse claire, polie et professionnelle au dernier message du fil.",
    "N'invente aucun fait : appuie-toi uniquement sur le fil et le contexte fourni.",
    "Ne génère que le corps du message (pas d'objet, pas d'en-têtes).",
  ];

  if (opts.recipient && opts.recipient.trim()) {
    lines.push(
      "",
      `Ta réponse est ADRESSÉE à : ${opts.recipient.trim()}. Réponds à CETTE personne, au nom de notre organisation.`,
      "Les messages provenant de notre organisation (mes associés / collègues) sont de NOTRE côté : ne leur réponds pas, tiens-en compte comme contexte.",
    );
  }

  if (opts.instruction && opts.instruction.trim()) {
    lines.push("", `Consigne de l'utilisateur : ${opts.instruction.trim()}`);
  }

  const notes = (opts.contextNotes ?? [])
    .map((n) => truncate(n, MAX_NOTE_CHARS))
    .filter((n) => n.length > 0);
  if (notes.length > 0) {
    lines.push(
      "",
      "Contexte issu de tes notes (à utiliser si pertinent) :",
      ...notes.map((n, i) => `[Note ${i + 1}] ${n}`),
    );
  }

  lines.push(
    "",
    `Objet du fil : ${threadSubject(thread)}`,
    "",
    "Fil de discussion :",
    serializeThread(thread),
  );
  return lines.join("\n");
}

/**
 * Prompt « réponses éclair » : 3 réponses TRÈS courtes, prêtes à envoyer, qui
 * couvrent les issues usuelles d'un fil (accepter, décliner, demander une
 * précision). Format imposé : une par ligne, préfixée d'un tiret — c'est ce qui
 * rend le découpage fiable avec un petit modèle local. PUR.
 */
export function buildInstantRepliesPrompt(thread: MailAiThread): string {
  return [
    "Voici un fil d'emails. Propose TROIS réponses possibles, très courtes.",
    "",
    serializeThread(thread),
    "",
    "Contraintes :",
    "- une réponse par ligne, préfixée d'un tiret ;",
    "- une à deux phrases maximum, prêtes à envoyer telles quelles ;",
    "- trois intentions différentes (par exemple : accepter, décliner, demander une précision) ;",
    "- même langue que le fil, ton professionnel, pas de formule de politesse longue ;",
    "- aucune signature, aucun objet, aucun commentaire de ta part.",
  ].join("\n");
}

/** Longueur au-delà de laquelle une « réponse éclair » n'en est plus une. */
const MAX_INSTANT_REPLY_CHARS = 220;

/**
 * Découpe la réponse du modèle en propositions courtes. Tolérant aux préfixes
 * (tiret, numérotation, guillemets) et aux bavardages : on ne garde que des
 * lignes plausibles, au plus trois. PUR.
 */
export function parseInstantReplies(raw: string): string[] {
  const out: string[] = [];
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const cleaned = line
      .trim()
      .replace(/^[-*\u2022]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/^["\u00ab\u00bb\s]+|["\u00ab\u00bb\s]+$/g, "")
      .trim();
    if (cleaned.length < 3 || cleaned.length > MAX_INSTANT_REPLY_CHARS) continue;
    // Une ligne qui se termine par « : » introduit une liste, pas une réponse.
    if (cleaned.endsWith(":")) continue;
    if (!out.includes(cleaned)) out.push(cleaned);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Prompt de classification Eisenhower (sortie JSON). Demande UNIQUEMENT un objet
 * JSON `{ "quadrant": "do" | "schedule" | "delegate" | "eliminate" }`. PUR.
 */
export function buildClassifyQuadrantPrompt(thread: MailAiThread): string {
  return [
    "Tu classes des emails dans la matrice d'Eisenhower selon l'urgence et l'importance.",
    "Quadrants possibles :",
    '- "do" : urgent ET important (à faire soi-même tout de suite).',
    '- "schedule" : important mais PAS urgent (à planifier).',
    '- "delegate" : urgent mais PAS important (à déléguer).',
    '- "eliminate" : ni urgent ni important (à éliminer/ignorer).',
    "",
    'Réponds UNIQUEMENT avec un objet JSON de la forme {"quadrant": "schedule"}.',
    "N'ajoute aucun texte autour du JSON.",
    "",
    `Objet du fil : ${threadSubject(thread)}`,
    "",
    "Fil de discussion :",
    serializeThread(thread),
  ].join("\n");
}

/**
 * Prompt d'extraction d'actions (sortie JSON). Demande un tableau d'objets
 * `{ "text": "..." }`. PUR. (Chemin de secours si `ollamaExtractActions`
 * d'@supernote/ai ne convient pas — voir `extractActions`.)
 */
export function buildExtractActionsPrompt(thread: MailAiThread): string {
  return [
    "Tu extrais les tâches/actions concrètes d'un fil d'emails, en français.",
    "Ne retiens que des actions explicites et exploitables (pas de généralités).",
    'Réponds UNIQUEMENT avec un tableau JSON d\'objets {"text": "..."}.',
    "Si aucune action n'est présente, retourne [].",
    "N'ajoute aucun texte autour du JSON.",
    "",
    `Objet du fil : ${threadSubject(thread)}`,
    "",
    "Fil de discussion :",
    serializeThread(thread),
  ].join("\n");
}

// ── Parsing robuste (purs, testés) ──────────────────────────────────────────

const VALID_QUADRANTS: readonly EisenhowerQuadrant[] = [
  "do",
  "schedule",
  "delegate",
  "eliminate",
];

function isQuadrant(v: unknown): v is EisenhowerQuadrant {
  return typeof v === "string" && (VALID_QUADRANTS as readonly string[]).includes(v);
}

/**
 * Parse robuste d'une réponse de classification Eisenhower. Accepte un JSON
 * `{"quadrant": "..."}`, une chaîne contenant le mot-clé, ou du JSON entouré de
 * prose / code fences. Fallback `"schedule"` (le quadrant le moins destructeur :
 * « à planifier » plutôt que « éliminer »). PUR & déterministe.
 */
export function parseQuadrantResponse(raw: string): EisenhowerQuadrant {
  const fallback: EisenhowerQuadrant = "schedule";
  if (!raw || typeof raw !== "string") return fallback;

  // 1) JSON (éventuellement entouré de prose / fences).
  const match = raw.match(/\{[\s\S]*?\}/);
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      if (parsed && typeof parsed === "object") {
        const q = (parsed as Record<string, unknown>).quadrant;
        if (isQuadrant(q)) return q;
      }
    } catch {
      /* fall through */
    }
  }

  // 2) Recherche brute du mot-clé dans le texte.
  const lower = raw.toLowerCase();
  for (const q of VALID_QUADRANTS) {
    if (lower.includes(q)) return q;
  }
  return fallback;
}

/**
 * Parse robuste d'une réponse d'extraction d'actions en `{ text }[]`. Accepte un
 * tableau JSON d'objets `{text}` ou de chaînes, entouré ou non de prose. PUR.
 */
export function parseActionsResponse(raw: string): { text: string }[] {
  if (!raw || typeof raw !== "string") return [];
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: { text: string }[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    let text: string | undefined;
    if (typeof item === "string") text = item;
    else if (item && typeof item === "object") {
      const t = (item as Record<string, unknown>).text;
      if (typeof t === "string") text = t;
    }
    const trimmed = text?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: trimmed });
  }
  return out;
}

// ── Construction du client (effet de bord) ──────────────────────────────────

/**
 * Construit un client Ollama depuis `getAiSettings()`. Lève une erreur claire si
 * l'IA n'est pas configurée (l'UI ne devrait de toute façon afficher les actions
 * que si `isAiConfigured()` est vrai, mais on double-garde ici).
 */
function buildClient(): ReturnType<typeof createOllamaClient> {
  const { baseUrl, model } = getAiSettings();
  if (!baseUrl?.trim() || !model?.trim()) {
    throw new Error(
      "IA locale non configurée : renseigne un modèle Ollama dans les réglages.",
    );
  }
  return createOllamaClient({ baseUrl, defaultModel: model });
}

/** Hôte Ollama pour le RAG (clé partagée avec l'auto-titre). */
function resolveRagHost(): string {
  if (typeof window === "undefined") return DEFAULT_OLLAMA_HOST;
  try {
    const stored = window.localStorage.getItem(OLLAMA_HOST_KEY);
    if (stored?.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  // À défaut, l'hôte de la config IA (même base que le client de génération).
  const { baseUrl } = getAiSettings();
  return baseUrl?.trim() || DEFAULT_OLLAMA_HOST;
}

/** Transforme une erreur réseau Ollama en message clair pour le toast UI. */
function asReachabilityError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(
    `Ollama injoignable ou en erreur (${msg}). Vérifie qu'Ollama tourne et que le modèle est installé.`,
  );
}

// ── Appels IA (effets de bord, NON testés réseau) ───────────────────────────

/**
 * Exécute un prompt libre sur l'IA LOCALE (Ollama) et renvoie le texte brut.
 * Sert aux usages mail qui ne méritent pas leur propre client (classement
 * automatique, assistant de boîte). Lève une erreur claire si Ollama est
 * injoignable.
 */
export async function runLocalPrompt(prompt: string, temperature = 0.1): Promise<string> {
  const client = buildClient();
  try {
    const text = await client.generate({ prompt, temperature });
    return text.trim();
  } catch (err) {
    throw asReachabilityError(err);
  }
}

/** Résume un fil via Ollama. Lève une erreur claire si injoignable. */
export async function summarizeThread(thread: MailAiThread): Promise<string> {
  const client = buildClient();
  try {
    const text = await client.generate({
      prompt: buildSummaryPrompt(thread),
      temperature: 0.2,
    });
    return text.trim();
  } catch (err) {
    throw asReachabilityError(err);
  }
}

/**
 * Propose jusqu'à 3 réponses éclair pour un fil. Lève une erreur claire si
 * Ollama est injoignable — l'appelant les masque alors simplement.
 */
export async function instantReplies(thread: MailAiThread): Promise<string[]> {
  const raw = await runLocalPrompt(buildInstantRepliesPrompt(thread), 0.3);
  return parseInstantReplies(raw);
}

export interface DraftReplyOptions extends BuildReplyPromptOptions {
  /** Si vrai, on récupère d'abord des notes de contexte via RAG (best-effort). */
  useNotes?: boolean;
}

/**
 * Génère un brouillon de réponse. Si `opts.useNotes`, récupère d'abord des notes
 * de contexte via RAG (best-effort : `[]` si indispo). Lève une erreur claire si
 * Ollama est injoignable pour la génération elle-même.
 */
export async function draftReply(
  thread: MailAiThread,
  opts: DraftReplyOptions = {},
): Promise<string> {
  let contextNotes = opts.contextNotes ?? [];
  if (opts.useNotes) {
    // Best-effort : une erreur RAG ne doit pas faire échouer le brouillon.
    try {
      contextNotes = await retrieveNotesForThread(thread);
    } catch {
      contextNotes = [];
    }
  }
  const client = buildClient();
  const promptOpts: BuildReplyPromptOptions = { contextNotes };
  if (opts.instruction !== undefined) promptOpts.instruction = opts.instruction;
  if (opts.recipient !== undefined) promptOpts.recipient = opts.recipient;
  try {
    const text = await client.generate({
      prompt: buildReplyPrompt(thread, promptOpts),
      temperature: 0.4,
    });
    return text.trim();
  } catch (err) {
    throw asReachabilityError(err);
  }
}

/** Un brouillon de réponse proposé, avec son angle/ton. */
export interface ReplyVariant {
  /** Identifiant stable de l'angle (clé React). */
  tone: string;
  /** Libellé court affiché sur la carte. */
  label: string;
  /** Corps du brouillon généré. */
  text: string;
}

/** Les angles proposés : favorable / réservé / précisions (cf. demande type). */
const REPLY_ANGLES: ReadonlyArray<{ tone: string; label: string; instruction: string }> = [
  {
    tone: "favorable",
    label: "Favorable",
    instruction:
      "Rédige une réponse FAVORABLE et positive : accepte la demande ou avance dans son sens, de façon engageante.",
  },
  {
    tone: "reserve",
    label: "Réservé",
    instruction:
      "Rédige une réponse qui exprime des RÉSERVES ou DÉCLINE poliment, avec un motif courtois et professionnel.",
  },
  {
    tone: "precisions",
    label: "Précisions",
    instruction:
      "Rédige une réponse NEUTRE qui demande des PRÉCISIONS ou temporise, sans s'engager fermement.",
  },
];

/**
 * Génère PLUSIEURS brouillons de réponse, un par angle (favorable / réservé /
 * précisions), pour que l'utilisateur choisisse. RAG (notes) résolu UNE fois.
 *
 * SÉQUENTIEL (pas en parallèle) à dessein : Ollama sérialise les requêtes sur un
 * même modèle ; lancer 3 prompts longs en parallèle fait dépasser le timeout aux
 * 2ᵉ/3ᵉ (→ une seule réponse survivait). En série, chacun a son budget de temps.
 * `onPartial` est appelé à chaque brouillon prêt → rendu progressif côté UI.
 * Angles en échec ignorés ; si TOUT échoue, on relaie l'erreur (Ollama injoignable).
 */
export async function draftReplyVariants(
  thread: MailAiThread,
  opts: DraftReplyOptions = {},
  onPartial?: (variant: ReplyVariant) => void,
): Promise<ReplyVariant[]> {
  let contextNotes = opts.contextNotes ?? [];
  if (opts.useNotes) {
    try {
      contextNotes = await retrieveNotesForThread(thread);
    } catch {
      contextNotes = [];
    }
  }
  const out: ReplyVariant[] = [];
  let lastErr: unknown = null;
  for (const angle of REPLY_ANGLES) {
    try {
      const text = (
        await draftReply(thread, {
          contextNotes,
          instruction: angle.instruction,
          ...(opts.recipient !== undefined ? { recipient: opts.recipient } : {}),
        })
      ).trim();
      if (!text) continue;
      const variant: ReplyVariant = { tone: angle.tone, label: angle.label, text };
      out.push(variant);
      onPartial?.(variant);
    } catch (err) {
      lastErr = err;
    }
  }
  if (out.length === 0) {
    throw lastErr ? asReachabilityError(lastErr) : new Error("Aucun brouillon généré.");
  }
  return out;
}

/**
 * Classe un fil dans un quadrant Eisenhower (sortie JSON, parse robuste). Lève
 * une erreur claire si Ollama est injoignable ; tout autre cas (JSON invalide,
 * réponse vide) retombe sur `"schedule"`.
 */
export async function suggestQuadrant(
  thread: MailAiThread,
): Promise<EisenhowerQuadrant> {
  const client = buildClient();
  try {
    const raw = await client.generate({
      prompt: buildClassifyQuadrantPrompt(thread),
      format: "json",
      temperature: 0.1,
    });
    return parseQuadrantResponse(raw);
  } catch (err) {
    throw asReachabilityError(err);
  }
}

/**
 * Extrait les actions concrètes d'un fil sous forme `{ text }[]`. Construit un
 * prompt JSON dédié (le fil multi-messages est sérialisé en texte ; l'extracteur
 * d'@supernote/ai prend une note unique, pas un fil — un prompt dédié colle
 * mieux). Lève une erreur claire si Ollama est injoignable.
 */
export async function extractActions(
  thread: MailAiThread,
): Promise<{ text: string }[]> {
  const client = buildClient();
  try {
    const raw = await client.generate({
      prompt: buildExtractActionsPrompt(thread),
      format: "json",
      temperature: 0.1,
    });
    return parseActionsResponse(raw);
  } catch (err) {
    throw asReachabilityError(err);
  }
}

// ── RAG : notes de contexte pour un fil (best-effort) ────────────────────────

/**
 * Récupère, best-effort, des extraits de notes du coffre pertinents pour un fil.
 *
 * Source des embeddings : identique à `@/lib/rag-indexer` — chaque note (entité)
 * porte `entity.fields.embedding` (tableau de nombres JSON-encodé) produit par
 * `runIndex`. On embed ici le `sujet + corps` du fil avec le MÊME modèle
 * d'embedding (`DEFAULT_EMBED_MODEL`), puis on classe les notes par similarité
 * cosinus.
 *
 * Renvoie `[]` (jamais d'exception) si : aucune note indexée, embeddings
 * absents, ou Ollama/coffre indisponible. Le brouillon sera alors généré SANS
 * contexte (l'appelant le signale à l'utilisateur).
 */
export async function retrieveNotesForThread(
  thread: MailAiThread,
): Promise<string[]> {
  try {
    const host = resolveRagHost();
    const queryText = truncate(
      `${threadSubject(thread)}\n\n${serializeThread(thread)}`,
      MAX_BODY_CHARS,
    );
    const queryVec = await embedQuery(queryText, host, DEFAULT_EMBED_MODEL);

    const listResult = await trpcVanillaClient.entities.list.query({
      limit: 5000,
      offset: 0,
    });
    const notes: EntitySummary[] = listResult.items;

    const scored: { score: number; text: string }[] = [];
    for (const note of notes) {
      const vec = parseEmbeddingField(note.fields["embedding"]);
      if (!vec) continue;
      const score = cosineSimilarity(queryVec, vec);
      if (score < MIN_NOTE_SIMILARITY) continue;
      const titleField = note.fields["title"];
      const title = typeof titleField === "string" ? titleField : "";
      const body = note.body ?? "";
      const text = [title, body].filter(Boolean).join("\n");
      if (!text.trim()) continue;
      scored.push({ score, text });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_CONTEXT_NOTES).map((s) => s.text);
  } catch {
    return [];
  }
}
