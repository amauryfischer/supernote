/**
 * mail-autolabel — classement automatique des nouveaux emails par l'IA LOCALE.
 *
 * Le système de groupes existant (cf. `mail-groups`) sait déjà router un fil
 * hors de la boîte selon ses labels Gmail — mais il fallait poser ces labels à
 * la main. Ici, l'IA locale lit expéditeur + objet + extrait (JAMAIS le HTML) et
 * range le fil dans une catégorie ; le label Gmail correspondant est appliqué,
 * et les vues par groupe s'en nourrissent sans nouvelle mécanique.
 *
 * Trois garde-fous assumés :
 *  - on ne classe QUE ce qui n'a pas encore été vu (registre local d'ids), pour
 *    ne pas repasser sur des fils que l'utilisateur a rangés autrement ;
 *  - rien n'est jamais SUPPRIMÉ ni archivé par le classement : il ajoute un
 *    label, point. Sortir de la boîte reste la décision du groupe configuré ;
 *  - un tag n'est posé QUE si le modèle est d'accord avec lui-même au-delà d'un
 *    seuil réglable (cf. « Confiance » plus bas). En dessous, le fil est laissé
 *    tel quel et compté comme « écarté » — un tag faux coûte plus cher qu'un
 *    tag absent, parce qu'il fait SORTIR le fil de la boîte via les groupes.
 *
 * Les fonctions de prompt et de parsing sont PURES ; l'appel réseau est isolé
 * dans `classifyThread`.
 */

import { runLocalPrompt } from "./mail-ai";

/** Préfixe des labels Gmail posés par le classement (regroupés dans Gmail). */
export const AUTO_LABEL_PREFIX = "Supernote/";

export interface MailCategory {
  id: string;
  /** Nom du label Gmail (créé à la demande). */
  labelName: string;
  /** Libellé affiché dans l'UI. */
  title: string;
  /** Description injectée dans le prompt — c'est elle qui fait le classement. */
  hint: string;
}

/**
 * Catégories volontairement peu nombreuses et sans recouvrement : un modèle
 * local se trompe surtout quand on lui propose des nuances. « Humain » est le
 * défaut implicite — ce qui ne ressemble à rien d'automatique n'est pas rangé.
 */
export const MAIL_CATEGORIES: readonly MailCategory[] = [
  {
    id: "newsletter",
    labelName: `${AUTO_LABEL_PREFIX}Newsletters`,
    title: "Newsletters",
    hint: "lettre d'information, veille, blog, contenu éditorial envoyé en masse",
  },
  {
    id: "notification",
    labelName: `${AUTO_LABEL_PREFIX}Notifications`,
    title: "Notifications",
    hint: "alerte automatique d'un service (CI, outil SaaS, réseau social, monitoring)",
  },
  {
    id: "facture",
    labelName: `${AUTO_LABEL_PREFIX}Factures`,
    title: "Factures",
    hint: "facture, reçu, confirmation de paiement, relevé, échéance comptable",
  },
  {
    id: "promo",
    labelName: `${AUTO_LABEL_PREFIX}Promotions`,
    title: "Promotions",
    hint: "publicité, offre commerciale, soldes, prospection non sollicitée",
  },
  {
    id: "agenda",
    labelName: `${AUTO_LABEL_PREFIX}Agenda`,
    title: "Agenda",
    hint: "invitation, rendez-vous, convocation, rappel de réunion",
  },
];

/** Identifiant de catégorie, ou "humain" quand rien ne correspond. */
export type MailCategoryId = (typeof MAIL_CATEGORIES)[number]["id"] | "humain";

/** Tous les noms de labels gérés par le classement. PUR. */
export function autoLabelNames(): string[] {
  return MAIL_CATEGORIES.map((c) => c.labelName);
}

/** Catégorie par id (undefined pour "humain"). PUR. */
export function categoryById(id: string): MailCategory | undefined {
  return MAIL_CATEGORIES.find((c) => c.id === id);
}

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

/**
 * Prompt de classement. On impose une réponse d'UN SEUL mot parmi une liste
 * fermée : c'est ce qui rend le parsing fiable avec un petit modèle local. PUR.
 */
export function buildCategoryPrompt(thread: ClassifiableThread): string {
  const options = [
    ...MAIL_CATEGORIES.map((c) => `- ${c.id} : ${c.hint}`),
    "- humain : écrit par une personne qui attend une réponse de moi",
  ].join("\n");
  return [
    "Tu classes un email dans UNE catégorie.",
    "",
    "Catégories possibles :",
    options,
    "",
    "Email :",
    `Expéditeur : ${clip(thread.from.name || thread.from.email, 120)} <${clip(thread.from.email, 120)}>`,
    `Objet : ${clip(thread.subject, 200)}`,
    `Extrait : ${clip(thread.snippet, 400)}`,
    "",
    "Réponds UNIQUEMENT par l'identifiant de la catégorie, en un seul mot, sans ponctuation.",
    "En cas de doute, réponds : humain",
  ].join("\n");
}

/**
 * Lit la réponse du modèle. Tolérant (le modèle bavarde souvent) : on cherche
 * le premier identifiant connu dans le texte. Défaut prudent : "humain" — ne
 * rien ranger vaut mieux que mal ranger. PUR.
 */
export function parseCategory(raw: string): MailCategoryId {
  const text = (raw ?? "").toLowerCase();
  for (const c of MAIL_CATEGORIES) {
    if (new RegExp(`\\b${c.id}\\b`).test(text)) return c.id;
  }
  return "humain";
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
  category: MailCategoryId;
  /** Part des passes d'accord (0..1). Consistance, PAS exactitude. */
  confidence: number;
  /** Passes réellement exécutées (1 pour « humain », 2 ou 3 sinon). */
  runs: number;
}

/**
 * Dépouille un vote : catégorie majoritaire et part des passes d'accord. En cas
 * d'égalité, la PREMIÈRE catégorie votée l'emporte — c'est celle de la passe
 * déterministe (température 0), la plus reproductible. PUR.
 */
export function tallyVotes(votes: readonly MailCategoryId[]): {
  category: MailCategoryId;
  confidence: number;
} {
  if (votes.length === 0) return { category: "humain", confidence: 0 };
  const counts = new Map<MailCategoryId, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = votes[0]!;
  let bestCount = counts.get(best) ?? 0;
  for (const v of votes) {
    const n = counts.get(v) ?? 0;
    // `>` strict : à égalité, on garde le vote rencontré en premier.
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return { category: best, confidence: bestCount / votes.length };
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
 * Passe 1 à température 0 (réponse de référence). Si elle dit « humain », on
 * s'arrête : rien ne sera posé de toute façon, inutile de payer deux passes de
 * plus — et c'est le cas le plus fréquent dans une boîte de travail.
 * Sinon passe 2 à température non nulle ; si elle confirme, c'est unanime ; si
 * elle infirme, une 3ᵉ passe départage.
 *
 * Lève si Ollama est injoignable.
 */
export async function classifyThread(
  thread: ClassifiableThread,
): Promise<ClassificationResult> {
  const prompt = buildCategoryPrompt(thread);
  const first = parseCategory(await runLocalPrompt(prompt, 0));
  if (first === "humain") return { category: "humain", confidence: 1, runs: 1 };

  const votes: MailCategoryId[] = [first];
  votes.push(parseCategory(await runLocalPrompt(prompt, VOTE_TEMPERATURE)));
  if (votes[0] !== votes[1] && MAX_VOTE_RUNS >= 3) {
    votes.push(parseCategory(await runLocalPrompt(prompt, VOTE_TEMPERATURE)));
  }
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
