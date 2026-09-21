/**
 * mail-sections — découpe la liste d'emails en SECTIONS avec un mini-en-tête,
 * au lieu d'un long ruban indifférencié (repère : Shortwave).
 *
 * Trois natures de section, dans cet ordre :
 *  1. « Todo » — les fils rangés dans un label de la matrice (cf.
 *     `mail-eisenhower`), repliée par défaut : ils vivent dans le split Todo.
 *  2. « Étoilés » — sorti des buckets temporels. Un fil qu'on a marqué compte
 *     plus que sa date : le remettre à sa place chronologique, c'est le perdre.
 *  3. Les buckets temporels (aujourd'hui, hier, 7 derniers jours, 30 derniers
 *     jours, plus ancien), qui donnent la profondeur de l'arriéré d'un coup d'œil.
 *
 * Contrainte structurante : la NAVIGATION CLAVIER indexe une liste plate de
 * lignes. Les sections ne peuvent donc pas être une arborescence — d'où
 * `flattenSections`, qui rend (a) les lignes réordonnées et repliées et (b) des
 * MARQUEURS disant à quel index insérer chaque en-tête. L'ordre visuel et
 * l'ordre clavier restent le même tableau, par construction.
 *
 * Tout est PUR (`now` injecté) sauf la persistance du repli.
 */

import { rowHasStar, type OverlayRow } from "./mail-overlay";

export type MailSectionId =
  | "starred"
  | "todo"
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "older";

export interface MailSection {
  id: MailSectionId;
  title: string;
  rows: OverlayRow[];
}

/** Libellés affichés, dans l'ordre d'apparition. */
const SECTION_TITLES: Record<MailSectionId, string> = {
  starred: "Étoilés",
  todo: "Todo",
  today: "Aujourd'hui",
  yesterday: "Hier",
  week: "7 derniers jours",
  month: "30 derniers jours",
  older: "Plus ancien",
};

/** Ordre canonique des sections. */
const SECTION_ORDER: readonly MailSectionId[] = [
  "todo",
  "starred",
  "today",
  "yesterday",
  "week",
  "month",
  "older",
];

/** Date la plus récente d'une ligne (ISO ; `""` si inconnue). PUR. */
export function rowDate(row: OverlayRow): string {
  return row.kind === "single" ? row.item.date : row.date;
}

/** Nombre de FILS d'une ligne (1 pour une ligne seule, N pour un groupe). PUR. */
export function rowThreadCount(row: OverlayRow): number {
  return row.kind === "single" ? 1 : row.count;
}

/** Ids des fils non lus d'une ligne. PUR. */
export function rowUnreadIds(row: OverlayRow): string[] {
  const items = row.kind === "single" ? [row.item] : row.items;
  return items.filter((it) => it.labelIds.includes("UNREAD")).map((it) => it.id);
}

/** Minuit local du jour de `ts`. PUR. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Bucket temporel d'une ligne. Une date vide ou illisible retombe sur `older` :
 * mieux vaut une ligne rangée au fond qu'une ligne prétendument du jour. PUR.
 */
function timeBucket(row: OverlayRow, now: number): MailSectionId {
  const iso = rowDate(row);
  const t = iso ? new Date(iso).getTime() : Number.NaN;
  if (Number.isNaN(t)) return "older";
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;
  // Un fil daté du futur (horloge désynchronisée, en-tête bidon) reste « aujourd'hui ».
  if (t >= today) return "today";
  if (t >= today - day) return "yesterday";
  if (t >= today - 7 * day) return "week";
  if (t >= today - 30 * day) return "month";
  return "older";
}

type RowItem = Extract<OverlayRow, { kind: "group" }>["items"][number];

function rowItems(row: OverlayRow): RowItem[] {
  return row.kind === "single" ? [row.item] : row.items;
}

/**
 * Un groupe mêlant fils étoilés (ou todo) et les autres est coupé en deux :
 * sinon un seul fil emporterait tout le groupe dans la section. La moitié
 * retenue garde la clé suffixée (deux lignes rendues ne partagent pas une clé).
 */
function splitRow(row: OverlayRow, test: (it: RowItem) => boolean, suffix: string): OverlayRow[] {
  if (row.kind === "single") return [row];
  const hit = row.items.filter(test);
  if (hit.length === 0 || hit.length === row.items.length) return [row];
  const rest = row.items.filter((it) => !test(it));
  const latest = (items: RowItem[]) =>
    items.reduce((max, it) => (it.date > max ? it.date : max), "");
  return [
    { ...row, key: `${row.key}${suffix}`, items: hit, count: hit.length, date: latest(hit) },
    { ...row, items: rest, count: rest.length, date: latest(rest) },
  ];
}

/**
 * Range les lignes en sections, en PRÉSERVANT leur ordre relatif à l'intérieur
 * de chaque section (la liste arrive déjà triée par date). Les sections vides
 * ne sont pas rendues. PUR.
 */
export function buildMailSections(
  rows: readonly OverlayRow[],
  now: number,
  todoLabelIds: ReadonlySet<string>,
): MailSection[] {
  const isTodo = (it: RowItem) => it.labelIds.some((id) => todoLabelIds.has(id));
  const isStarred = (it: RowItem) => it.labelIds.includes("STARRED");
  const buckets = new Map<MailSectionId, OverlayRow[]>();
  const split = rows
    .flatMap((r) => splitRow(r, isTodo, "#todo"))
    .flatMap((r) => (rowItems(r).some(isTodo) ? [r] : splitRow(r, isStarred, "#star")));
  for (const row of split) {
    const id = rowItems(row).some(isTodo)
      ? "todo"
      : rowHasStar(row)
        ? "starred"
        : timeBucket(row, now);
    const arr = buckets.get(id);
    if (arr) arr.push(row);
    else buckets.set(id, [row]);
  }
  return SECTION_ORDER.flatMap((id) => {
    const rowsOf = buckets.get(id);
    if (!rowsOf || rowsOf.length === 0) return [];
    return [{ id, title: SECTION_TITLES[id], rows: rowsOf }];
  });
}

/** En-tête de section, positionné dans la liste plate des lignes. */
export interface MailSectionMarker {
  id: MailSectionId;
  title: string;
  /** Index, dans les lignes rendues, AVANT lequel poser l'en-tête. */
  index: number;
  /** Nombre de fils de la section (groupes dépliés). */
  count: number;
  /** Fils non lus de la section. */
  unread: number;
  /** Ids des fils non lus — cible de « tout marquer lu ». */
  unreadIds: string[];
  collapsed: boolean;
}

export interface FlatSections {
  /** Lignes réellement rendues, dans l'ordre d'affichage ET de navigation. */
  rows: OverlayRow[];
  markers: MailSectionMarker[];
}

/**
 * Aplatit les sections en une liste de lignes + des marqueurs d'en-tête. Une
 * section repliée garde son marqueur (donc son en-tête, donc le moyen de la
 * rouvrir) mais n'apporte aucune ligne — le curseur clavier ne peut pas se
 * poser sur ce qui n'est pas affiché. PUR.
 */
export function flattenSections(
  sections: readonly MailSection[],
  collapsed: ReadonlySet<MailSectionId>,
): FlatSections {
  const rows: OverlayRow[] = [];
  const markers: MailSectionMarker[] = [];
  for (const section of sections) {
    const isCollapsed = collapsed.has(section.id);
    const unreadIds = section.rows.flatMap(rowUnreadIds);
    markers.push({
      id: section.id,
      title: section.title,
      index: rows.length,
      count: section.rows.reduce((n, r) => n + rowThreadCount(r), 0),
      unread: unreadIds.length,
      unreadIds,
      collapsed: isCollapsed,
    });
    if (!isCollapsed) rows.push(...section.rows);
  }
  return { rows, markers };
}

// ── Persistance du repli ────────────────────────────────────────────────────

const COLLAPSED_KEY = "supernote.mail.collapsedSections";

// Le stockage garde les ÉCARTS à ce défaut, pas l'état brut : une valeur
// enregistrée avant l'ajout d'une section repliée par défaut reste valable.
const DEFAULT_COLLAPSED: readonly MailSectionId[] = ["todo"];

function flipDefaults(ids: Iterable<MailSectionId>): Set<MailSectionId> {
  const out = new Set(DEFAULT_COLLAPSED);
  for (const id of ids) {
    if (out.has(id)) out.delete(id);
    else out.add(id);
  }
  return out;
}

export function loadCollapsedSections(): Set<MailSectionId> {
  if (typeof window === "undefined") return new Set(DEFAULT_COLLAPSED);
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set(DEFAULT_COLLAPSED);
    return flipDefaults(
      parsed.filter((v): v is MailSectionId =>
        typeof v === "string" && (SECTION_ORDER as readonly string[]).includes(v),
      ),
    );
  } catch {
    return new Set(DEFAULT_COLLAPSED);
  }
}

export function saveCollapsedSections(ids: ReadonlySet<MailSectionId>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...flipDefaults(ids)]));
  } catch {
    /* quota — best-effort */
  }
}
