/**
 * mail-search — analyse de la requête de recherche mail + historique local.
 *
 * Une SEULE syntaxe pour deux moteurs : la chaîne saisie est comprise
 * localement (filtrage instantané du mirror) ET envoyée telle quelle à Gmail
 * quand l'utilisateur valide (recherche exhaustive). On reste donc sur la
 * syntaxe Gmail — rien de propriétaire à réapprendre.
 *
 * Opérateurs reconnus : `from:` `to:` `subject:` `label:` `is:` `has:`
 * `after:` `before:`. Tout le reste est du texte libre.
 *
 * 100 % pur (hors historique, qui touche le localStorage explicitement).
 */

/** Filtres extraits d'une requête, prêts à être appliqués au mirror local. */
export interface ParsedMailQuery {
  /** Mots libres (hors opérateurs), en minuscules. */
  terms: string[];
  from: string[];
  to: string[];
  subject: string[];
  label: string[];
  isUnread: boolean;
  isRead: boolean;
  isStarred: boolean;
  hasAttachment: boolean;
  /** Bornes de date (epoch ms), issues de `after:` / `before:`. */
  after?: number;
  before?: number;
}

/** Un filtre affiché sous forme de puce dans la barre de recherche. */
export interface QueryChip {
  /** Opérateur (`from`, `is`, …) ou `"texte"` pour les mots libres. */
  kind: string;
  /** Valeur lisible. */
  value: string;
  /** Fragment exact à retirer de la requête quand on ferme la puce. */
  token: string;
}

const OPERATORS = ["from", "to", "subject", "label", "is", "has", "after", "before"] as const;
type Operator = (typeof OPERATORS)[number];

/**
 * Découpe une requête en jetons en respectant les guillemets
 * (`subject:"devis final"` reste un seul jeton). PUR.
 */
export function tokenizeQuery(raw: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of raw) {
    if (ch === '"') {
      quoted = !quoted;
      cur += ch;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Retire les guillemets encadrants d'une valeur. PUR. */
function unquote(v: string): string {
  return v.startsWith('"') && v.endsWith('"') && v.length >= 2 ? v.slice(1, -1) : v;
}

/** Parse une date `YYYY-MM-DD` (ou `YYYY/MM/DD`) en epoch ms local. PUR. */
function parseDate(v: string): number | undefined {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v.trim());
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isFinite(d.getTime()) ? d.getTime() : undefined;
}

/** Analyse une requête Gmail en filtres exploitables localement. PUR. */
export function parseMailQuery(raw: string): ParsedMailQuery {
  const parsed: ParsedMailQuery = {
    terms: [],
    from: [],
    to: [],
    subject: [],
    label: [],
    isUnread: false,
    isRead: false,
    isStarred: false,
    hasAttachment: false,
  };
  for (const token of tokenizeQuery(raw)) {
    const idx = token.indexOf(":");
    if (idx <= 0) {
      const t = token.trim().toLowerCase();
      if (t) parsed.terms.push(unquote(t));
      continue;
    }
    const op = token.slice(0, idx).toLowerCase() as Operator;
    const value = unquote(token.slice(idx + 1)).trim();
    if (!value || !OPERATORS.includes(op)) {
      const t = token.trim().toLowerCase();
      if (t) parsed.terms.push(t);
      continue;
    }
    switch (op) {
      case "from":
        parsed.from.push(value.toLowerCase());
        break;
      case "to":
        parsed.to.push(value.toLowerCase());
        break;
      case "subject":
        parsed.subject.push(value.toLowerCase());
        break;
      case "label":
        parsed.label.push(value.toLowerCase());
        break;
      case "is": {
        const v = value.toLowerCase();
        if (v === "unread") parsed.isUnread = true;
        else if (v === "read") parsed.isRead = true;
        else if (v === "starred") parsed.isStarred = true;
        break;
      }
      case "has":
        if (value.toLowerCase() === "attachment") parsed.hasAttachment = true;
        break;
      case "after": {
        const t = parseDate(value);
        if (t !== undefined) parsed.after = t;
        break;
      }
      case "before": {
        const t = parseDate(value);
        if (t !== undefined) parsed.before = t;
        break;
      }
    }
  }
  return parsed;
}

/** Puces affichées sous la barre de recherche (une par filtre actif). PUR. */
export function queryChips(raw: string): QueryChip[] {
  const chips: QueryChip[] = [];
  for (const token of tokenizeQuery(raw)) {
    const idx = token.indexOf(":");
    if (idx <= 0) {
      chips.push({ kind: "texte", value: unquote(token), token });
      continue;
    }
    const op = token.slice(0, idx).toLowerCase();
    const value = unquote(token.slice(idx + 1));
    if (!OPERATORS.includes(op as Operator) || !value) {
      chips.push({ kind: "texte", value: unquote(token), token });
      continue;
    }
    chips.push({ kind: op, value, token });
  }
  return chips;
}

/** Retire un jeton exact d'une requête (fermeture d'une puce). PUR. */
export function removeToken(raw: string, token: string): string {
  return tokenizeQuery(raw)
    .filter((t) => t !== token)
    .join(" ");
}

/** La requête ne contient-elle QUE des espaces / rien d'exploitable ? PUR. */
export function isEmptyQuery(raw: string): boolean {
  return tokenizeQuery(raw).length === 0;
}

// ── Suggestions d'opérateurs ────────────────────────────────────────────────

export interface OperatorSuggestion {
  /** Fragment inséré dans le champ. */
  insert: string;
  label: string;
  hint: string;
}

/** Opérateurs proposés sous le champ (aide à la syntaxe, pas un menu figé). */
export const OPERATOR_SUGGESTIONS: OperatorSuggestion[] = [
  { insert: "from:", label: "from:", hint: "expéditeur" },
  { insert: "to:", label: "to:", hint: "destinataire" },
  { insert: "subject:", label: "subject:", hint: "objet" },
  { insert: "is:unread", label: "is:unread", hint: "non lus" },
  { insert: "is:starred", label: "is:starred", hint: "suivis" },
  { insert: "has:attachment", label: "has:attachment", hint: "avec pièce jointe" },
  { insert: "label:", label: "label:", hint: "tag" },
  { insert: "after:", label: "after:", hint: "après le AAAA-MM-JJ" },
];

// ── Historique de recherche (localStorage) ──────────────────────────────────

const HISTORY_KEY = "supernote.mail.searchHistory";
const HISTORY_MAX = 12;

/** Dernières recherches, plus récentes d'abord. Tolérant aux données cassées. */
export function loadSearchHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Empile une recherche dans l'historique (dédupliquée, la plus récente en tête,
 * plafonnée). Une requête vide n'est jamais enregistrée.
 */
export function pushSearchHistory(query: string): string[] {
  const q = query.trim();
  if (!q || typeof window === "undefined") return loadSearchHistory();
  const next = [q, ...loadSearchHistory().filter((h) => h !== q)].slice(0, HISTORY_MAX);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* quota / storage désactivé — best-effort */
  }
  return next;
}

/** Vide l'historique de recherche. */
export function clearSearchHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* best-effort */
  }
}
