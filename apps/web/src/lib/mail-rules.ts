/**
 * mail-rules — règles locales « si … alors … » sur les emails entrants, et
 * PROPOSITION de règles à partir des gestes répétés.
 *
 * Gmail a ses filtres, mais l'API ne les expose pas sans le scope
 * `gmail.settings.basic` — et surtout, une règle utile naît de ce qu'on fait à
 * la main : archiver trois fois de suite les mêmes notifications. On enregistre
 * donc les gestes (par expéditeur et par action), et au bout de quelques
 * répétitions on PROPOSE la règle. Rien n'est jamais créé tout seul.
 *
 * Les règles s'appliquent côté Supernote, à chaque rafraîchissement de la
 * boîte : elles posent un label, archivent, marquent lu ou mettent une étoile.
 * Elles ne suppriment JAMAIS — une règle qui efface du courrier sans qu'on
 * regarde est un piège, pas un confort.
 *
 * Toute la logique de correspondance est PURE ; seules load/save touchent au
 * localStorage.
 */

const RULES_KEY = "supernote.mail.rules";
const LOG_KEY = "supernote.mail.actionLog";

/** Émis à chaque changement de règle (le gestionnaire se rafraîchit). */
export const MAIL_RULES_EVENT = "supernote:mail-rules";

/** Actions qu'une règle peut déclencher. Pas de suppression, volontairement. */
export interface MailRuleActions {
  addLabelId?: string;
  archive?: boolean;
  markRead?: boolean;
  star?: boolean;
}

/** Conditions d'une règle : TOUTES doivent être vraies. */
export interface MailRuleConditions {
  /** Sous-chaîne cherchée dans le nom OU l'adresse de l'expéditeur. */
  fromContains?: string;
  /** Sous-chaîne cherchée dans l'objet. */
  subjectContains?: string;
  /** Le fil porte ce label. */
  hasLabelId?: string;
}

export interface MailRule {
  id: string;
  name: string;
  enabled: boolean;
  when: MailRuleConditions;
  then: MailRuleActions;
  createdAt: number;
  /** Nombre de fils traités par cette règle (affiché dans le gestionnaire). */
  applied: number;
}

function emit(key: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(key));
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — best-effort */
  }
}

function isRule(v: unknown): v is MailRule {
  if (typeof v !== "object" || v === null) return false;
  const o = v as MailRule;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.name === "string" &&
    typeof o.enabled === "boolean" &&
    typeof o.when === "object" &&
    o.when !== null &&
    typeof o.then === "object" &&
    o.then !== null
  );
}

/** Règles enregistrées. Tolérant aux données cassées. */
export function loadRules(): MailRule[] {
  const raw = readJson<unknown>(RULES_KEY, []);
  return Array.isArray(raw) ? raw.filter(isRule) : [];
}

export function saveRules(rules: MailRule[]): void {
  writeJson(RULES_KEY, rules.filter(isRule));
  emit(MAIL_RULES_EVENT);
}

/** Ajoute ou remplace une règle. */
export function upsertRule(rule: MailRule): MailRule[] {
  const next = [...loadRules().filter((r) => r.id !== rule.id), rule];
  saveRules(next);
  return next;
}

/** Retire une règle. */
export function removeRule(id: string): MailRule[] {
  const next = loadRules().filter((r) => r.id !== id);
  saveRules(next);
  return next;
}

/** Identifiant de règle. */
export function newRuleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

// ── Correspondance (PUR) ────────────────────────────────────────────────────

/** Fil, réduit à ce dont une règle a besoin. */
export interface RuleTargetThread {
  id: string;
  subject: string;
  from: { name: string; email: string };
  labelIds: string[];
}

/** Sous-chaîne présente, insensible à la casse. PUR. */
function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

/**
 * La règle s'applique-t-elle à ce fil ? Une règle SANS condition ne s'applique
 * à rien : sinon la première règle vide viderait la boîte. PUR.
 */
export function ruleMatches(rule: MailRule, thread: RuleTargetThread): boolean {
  const { fromContains, subjectContains, hasLabelId } = rule.when;
  if (!fromContains?.trim() && !subjectContains?.trim() && !hasLabelId) return false;
  if (fromContains?.trim()) {
    const who = `${thread.from.name} ${thread.from.email}`;
    if (!contains(who, fromContains)) return false;
  }
  if (subjectContains?.trim() && !contains(thread.subject, subjectContains)) return false;
  if (hasLabelId && !thread.labelIds.includes(hasLabelId)) return false;
  return true;
}

/** Une correspondance : le fil et la règle qui s'y applique. */
export interface RuleMatch {
  thread: RuleTargetThread;
  rule: MailRule;
}

/**
 * Premières correspondances trouvées pour un lot de fils : une seule règle par
 * fil (la première qui matche), pour que deux règles contradictoires ne se
 * battent pas sur le même email. PUR.
 */
export function matchRules(
  threads: readonly RuleTargetThread[],
  rules: readonly MailRule[],
): RuleMatch[] {
  const active = rules.filter((r) => r.enabled);
  const out: RuleMatch[] = [];
  for (const thread of threads) {
    const rule = active.find((r) => ruleMatches(r, thread));
    if (rule) out.push({ thread, rule });
  }
  return out;
}

/** Incrémente le compteur d'applications d'une règle. */
export function bumpApplied(id: string, n = 1): void {
  saveRules(loadRules().map((r) => (r.id === id ? { ...r, applied: r.applied + n } : r)));
}

// ── Journal des gestes et propositions ──────────────────────────────────────

/** Action manuelle observée, agrégée par expéditeur. */
export type LoggedAction = "archive" | "label";

interface ActionLogEntry {
  /** Adresse de l'expéditeur (normalisée). */
  from: string;
  action: LoggedAction;
  /** Pour `label` : l'identifiant du label posé. */
  labelId?: string;
  count: number;
  lastAt: number;
}

/** Nombre de répétitions à partir duquel une règle est proposée. */
export const SUGGESTION_THRESHOLD = 3;

/** Au-delà, les entrées les plus anciennes sont oubliées. */
const LOG_MAX = 200;

function loadLog(): ActionLogEntry[] {
  const raw = readJson<unknown>(LOG_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is ActionLogEntry =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as ActionLogEntry).from === "string" &&
      typeof (v as ActionLogEntry).count === "number",
  );
}

/**
 * Note un geste manuel. C'est la matière première des propositions : sans lui,
 * on ne pourrait que deviner.
 */
export function recordAction(from: string, action: LoggedAction, labelId?: string): void {
  const addr = from.trim().toLowerCase();
  if (!addr) return;
  const log = loadLog();
  const key = (e: ActionLogEntry) =>
    e.from === addr && e.action === action && e.labelId === labelId;
  const existing = log.find(key);
  if (existing) {
    existing.count += 1;
    existing.lastAt = Date.now();
  } else {
    log.push({
      from: addr,
      action,
      ...(labelId ? { labelId } : {}),
      count: 1,
      lastAt: Date.now(),
    });
  }
  writeJson(LOG_KEY, log.slice(-LOG_MAX));
}

/** Oublie le journal pour un expéditeur (règle créée ou proposition refusée). */
export function forgetActions(from: string): void {
  const addr = from.trim().toLowerCase();
  writeJson(
    LOG_KEY,
    loadLog().filter((e) => e.from !== addr),
  );
}

/** Une règle proposée à l'utilisateur, prête à être créée telle quelle. */
export interface RuleSuggestion {
  from: string;
  action: LoggedAction;
  labelId?: string;
  count: number;
}

/**
 * Propositions de règles : un même geste répété au moins `SUGGESTION_THRESHOLD`
 * fois sur le même expéditeur, et pas déjà couvert par une règle existante.
 * PUR (le journal et les règles sont injectables pour les tests).
 */
export function suggestRules(
  log: ActionLogEntry[] = loadLog(),
  rules: MailRule[] = loadRules(),
): RuleSuggestion[] {
  return log
    .filter((e) => e.count >= SUGGESTION_THRESHOLD)
    .filter(
      (e) =>
        !rules.some(
          (r) => (r.when.fromContains ?? "").trim().toLowerCase() === e.from,
        ),
    )
    .sort((a, b) => b.count - a.count)
    .map((e) => ({
      from: e.from,
      action: e.action,
      ...(e.labelId ? { labelId: e.labelId } : {}),
      count: e.count,
    }));
}

/** Construit une règle à partir d'une proposition acceptée. PUR. */
export function ruleFromSuggestion(s: RuleSuggestion, labelName?: string): MailRule {
  return {
    id: newRuleId(),
    name:
      s.action === "archive"
        ? `Archiver les emails de ${s.from}`
        : `Classer ${s.from} dans ${labelName ?? "le tag habituel"}`,
    enabled: true,
    when: { fromContains: s.from },
    then:
      s.action === "archive"
        ? { archive: true }
        : { ...(s.labelId ? { addLabelId: s.labelId } : {}) },
    createdAt: Date.now(),
    applied: 0,
  };
}
