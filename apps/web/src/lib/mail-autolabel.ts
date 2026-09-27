/**
 * mail-autolabel — classement automatique des nouveaux emails par l'IA LOCALE.
 *
 * L'IA locale lit expéditeur + objet + extrait (JAMAIS le HTML) et choisit un
 * label parmi ceux de l'utilisateur, ou en crée un sous `Supernote/` quand aucun
 * ne convient à un email d'une famille récurrente.
 *
 * Garde-fous :
 *  - on ne classe QUE les fils jamais vus et sans label utilisateur ;
 *  - interdits : labels Todo (la matrice reste une décision humaine) et labels
 *    d'un split (`mail-groups`), qui SORTIRAIENT le fil de la boîte ;
 *  - rien n'est supprimé ni archivé : on ajoute un label, point ;
 *  - un label n'est posé QUE si le modèle est d'accord avec lui-même au-delà
 *    d'un seuil réglable (cf. « Confiance » plus bas).
 *
 * Les fonctions de prompt et de parsing sont PURES ; l'appel réseau est isolé
 * dans `classifyThread`.
 */

import { runLocalPrompt } from "./mail-ai";

/** Préfixe des labels Gmail créés par le classement (regroupés dans Gmail). */
export const AUTO_LABEL_PREFIX = "Supernote/";

/** Verdict brut : un label existant (nom exact), un label à créer, ou rien. */
export type LabelVote =
  | { kind: "existing"; name: string }
  | { kind: "new"; name: string }
  | { kind: "none" };

/** Entrée minimale nécessaire au classement (aucun HTML). */
export interface ClassifiableThread {
  subject: string;
  from: { name: string; email: string };
  snippet: string;
}

/** Tronque un texte pour le prompt. PUR. */
function clip(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Un petit modèle se noie au-delà : les labels les plus courts passent en premier. */
const MAX_LABELS_IN_PROMPT = 80;
const NEW_MARKER = "NOUVEAU:";

/** Prompt de classement. `allowed` = noms des labels que l'IA a le droit de poser. PUR. */
export function buildLabelPrompt(thread: ClassifiableThread, allowed: readonly string[]): string {
  const list = [...allowed]
    .sort((a, b) => a.length - b.length)
    .slice(0, MAX_LABELS_IN_PROMPT)
    .sort((a, b) => a.localeCompare(b, "fr"));
  return [
    "Tu ranges un email avec UN label.",
    "",
    list.length ? "Labels existants :" : "Aucun label existant.",
    ...list.map((n) => `- ${n}`),
    "",
    "Email :",
    `Expéditeur : ${clip(thread.from.name || thread.from.email, 120)} <${clip(thread.from.email, 120)}>`,
    `Objet : ${clip(thread.subject, 200)}`,
    `Extrait : ${clip(thread.snippet, 400)}`,
    "",
    "Réponds sur UNE seule ligne, sans autre texte, par l'un de :",
    "- le nom EXACT d'un label existant qui convient ;",
    `- ${NEW_MARKER} <Nom court> si aucun ne convient et que l'email appartient à une famille qui reviendra (newsletter, factures, notifications d'un outil, un fournisseur, un projet…). N'hésite pas à créer : 1 à 3 mots, en français, sans « / » ;`,
    "- aucun : si l'email est un message personnel isolé qui attend une réponse de moi.",
  ].join("\n");
}

/** Nom proposé par le modèle → nom de label sûr (sans préfixe ni « / »). PUR. */
function cleanNewName(raw: string): string {
  let n = raw.trim().replace(/^["'«\s]+|["'»\s.]+$/g, "");
  if (n.toLowerCase().startsWith(AUTO_LABEL_PREFIX.toLowerCase())) n = n.slice(AUTO_LABEL_PREFIX.length);
  n = n.replace(/[/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return n ? n[0]!.toUpperCase() + n.slice(1) : "";
}

/**
 * Lit la réponse du modèle. Tolérant (il bavarde) mais prudent : un label
 * existant doit être cité en entier ; défaut « rien » — ne pas ranger vaut mieux
 * que mal ranger. PUR.
 */
export function parseLabelVote(raw: string, allowed: readonly string[]): LabelVote {
  const line = (raw ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const bare = line.replace(/^[-*\s"'«]+|["'»\s.]+$/g, "");
  const lower = bare.toLowerCase();
  if (!bare || /^aucun\b/.test(lower)) return { kind: "none" };

  const exact = allowed.find((n) => n.toLowerCase() === lower);
  if (exact) return { kind: "existing", name: exact };

  const idx = lower.indexOf(NEW_MARKER.toLowerCase());
  if (idx >= 0) {
    const name = cleanNewName(bare.slice(idx + NEW_MARKER.length));
    if (!name || isTodoLabelName(name)) return { kind: "none" };
    const full = `${AUTO_LABEL_PREFIX}${name}`.toLowerCase();
    const same = allowed.find((n) => n.toLowerCase() === full || n.toLowerCase() === name.toLowerCase());
    return same ? { kind: "existing", name: same } : { kind: "new", name: `${AUTO_LABEL_PREFIX}${name}` };
  }

  // Le plus long d'abord : « Factures EDF » ne doit pas céder à « Factures ».
  const cited = [...allowed]
    .sort((a, b) => b.length - a.length)
    .find((n) => new RegExp(`(^|[^\\p{L}\\d])${escapeRegExp(n.toLowerCase())}([^\\p{L}\\d]|$)`, "u").test(lower));
  return cited ? { kind: "existing", name: cited } : { kind: "none" };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function voteKey(v: LabelVote): string {
  return v.kind === "none" ? "none" : v.name.toLowerCase();
}

/**
 * Labels que l'IA peut poser : labels utilisateur, hors Todo, hors splits, hors
 * labels à mon adresse. PUR.
 */
export function allowedLabelNames(
  labelNames: ReadonlyMap<string, string>,
  forbiddenIds: ReadonlySet<string>,
): string[] {
  return [...labelNames]
    .filter(([id, name]) => isUserLabelId(id) && !forbiddenIds.has(id) && !isTodoLabelName(name))
    .map(([, name]) => name);
}

/** Tout label « Todo… » : la matrice et ses variantes restent humaines. PUR. */
export function isTodoLabelName(name: string): boolean {
  return /^\s*todo\b/i.test(name);
}

// ── Confiance : accord du modèle avec lui-même ──────────────────────────────
// Un petit modèle local à qui on DEMANDE sa confiance répond « 95 % » à peu
// près toujours : l'auto-évaluation ne discrimine rien. Ce qui discrimine, en
// revanche, c'est son ACCORD AVEC LUI-MÊME : on reclasse le même email à
// température non nulle et on regarde s'il dit la même chose. Un email
// franchement typé (facture, newsletter) donne la même réponse à chaque passe ;
// un email ambigu part dans tous les sens.
//
// À dire clairement, parce que la nuance compte : cette mesure est une
// CONSISTANCE, pas une probabilité d'avoir raison. Un modèle peut être
// constamment dans l'erreur. Elle écarte les cas douteux, elle ne garantit pas
// les autres — d'où un défaut prudent et un tag qui reste défaisable.

/** Passes de vote au maximum (la 3ᵉ ne sert qu'à départager). */
const MAX_VOTE_RUNS = 3;

/** Température des passes de contrôle (0 rendrait la même réponse, sans info). */
const VOTE_TEMPERATURE = 0.7;

export interface ClassificationResult {
  vote: LabelVote;
  /** Part des passes d'accord (0..1). Consistance, PAS exactitude. */
  confidence: number;
  /** Passes réellement exécutées (1 pour « aucun », 2 ou 3 sinon). */
  runs: number;
}

/**
 * Dépouille un vote : verdict majoritaire et part des passes d'accord. En cas
 * d'égalité, le PREMIER voté l'emporte — celui de la passe déterministe
 * (température 0), la plus reproductible. PUR.
 */
export function tallyVotes(votes: readonly LabelVote[]): { vote: LabelVote; confidence: number } {
  if (votes.length === 0) return { vote: { kind: "none" }, confidence: 0 };
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(voteKey(v), (counts.get(voteKey(v)) ?? 0) + 1);
  let best = votes[0]!;
  let bestCount = counts.get(voteKey(best)) ?? 0;
  for (const v of votes) {
    const n = counts.get(voteKey(v)) ?? 0;
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return { vote: best, confidence: bestCount / votes.length };
}

/** Niveaux de confiance exposés dans les réglages. */
export const CONFIDENCE_LEVELS: ReadonlyArray<{
  value: string;
  label: string;
  threshold: number;
}> = [
  { value: "strict", label: "Prudent — le modèle doit être unanime", threshold: 1 },
  { value: "balanced", label: "Équilibré — majorité nette (2 voix sur 3)", threshold: 0.66 },
  { value: "loose", label: "Permissif — simple majorité", threshold: 0.34 },
];

/** Seuil par défaut : unanimité. Mieux vaut ne pas ranger que mal ranger. */
export const DEFAULT_CONFIDENCE_LEVEL = "strict";

/** Seuil numérique d'un niveau (inconnu → défaut prudent). PUR. */
export function confidenceThreshold(level: string | undefined): number {
  return CONFIDENCE_LEVELS.find((l) => l.value === level)?.threshold ?? 1;
}

/**
 * Classe un fil via l'IA locale, avec sa confiance.
 *
 * Passe 1 à température 0. Si elle dit « aucun », on s'arrête : c'est le cas le
 * plus fréquent dans une boîte de travail. Sinon passe 2 à température non
 * nulle ; si elle infirme, une 3ᵉ passe départage.
 *
 * Lève si Ollama est injoignable.
 */
export async function classifyThread(
  thread: ClassifiableThread,
  allowed: readonly string[],
): Promise<ClassificationResult> {
  const prompt = buildLabelPrompt(thread, allowed);
  const ask = async (t: number) => parseLabelVote(await runLocalPrompt(prompt, t), allowed);
  const first = await ask(0);
  if (first.kind === "none") return { vote: first, confidence: 1, runs: 1 };

  const votes: LabelVote[] = [first, await ask(VOTE_TEMPERATURE)];
  if (voteKey(votes[0]!) !== voteKey(votes[1]!) && MAX_VOTE_RUNS >= 3) votes.push(await ask(VOTE_TEMPERATURE));
  return { ...tallyVotes(votes), runs: votes.length };
}

// ── Registre des fils déjà vus ──────────────────────────────────────────────
// Un fil est « vu » quand `aiCategoryAt` est renseigné sur la row mail_thread
// (via mail.setAiCategory). Plus de localStorage — le résultat vit dans SQLite
// et se synchronise entre devices via l'entity email_ai_cache.

/** @deprecated Conservée pour la migration one-shot (vidage localStorage). */
export function loadSeenLegacy(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem("supernote.mail.autolabelSeen");
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

/** @deprecated Supprime l'ancienne clé localStorage après migration. */
export function clearSeenLegacy(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("supernote.mail.autolabelSeen");
  } catch { /* best-effort */ }
}

/**
 * Fils restant à classer : sans `aiCategoryAt` (jamais passés par l'IA), et
 * sans AUCUN label utilisateur — l'IA ne repasse pas derrière un rangement déjà
 * fait, qu'il vienne d'elle ou de l'utilisateur. `ignoredLabelIds` ne comptent
 * pas comme rangement (cf. `selfLabelIds`). PUR.
 */
export function pendingForClassification<
  T extends { id: string; labelIds: string[]; aiCategoryAt?: number | null },
>(items: readonly T[], ignoredLabelIds?: ReadonlySet<string>): T[] {
  return items.filter(
    (it) =>
      !it.aiCategoryAt && !it.labelIds.some((id) => isUserLabelId(id) && !ignoredLabelIds?.has(id)),
  );
}

/**
 * Labels nommés d'après une de mes adresses (filtre Gmail d'une boîte partagée,
 * ex. `contact@…`) : posés sur presque tout, ils ne disent rien du contenu.
 */
export function selfLabelIds(
  labelNames: ReadonlyMap<string, string>,
  selfAddresses: readonly string[],
): Set<string> {
  const self = new Set(selfAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
  return new Set([...labelNames].filter(([, name]) => self.has(name.trim().toLowerCase())).map(([id]) => id));
}

// Gmail préfixe les labels utilisateur par `Label_` (les système : INBOX, CATEGORY_…).
// Préféré à la table des labels de la page, vide tant qu'elle charge.
function isUserLabelId(id: string): boolean {
  return id.startsWith("Label_");
}
