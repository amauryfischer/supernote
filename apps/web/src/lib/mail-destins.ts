import type { ThreadListItem } from "@/lib/gmail";
import { isMachineAddress } from "@/lib/contact-from-email";
import { awaitsMyReply, isSelfAddress } from "@/lib/mail-awaiting";
import { senderHue } from "@/lib/mail-avatar";

/** Destin d'un mail : ce qu'il va devenir, pas quand il est arrivé. */
export type DestinKind = "libre" | "repondre" | "lot" | "avec" | "reunion" | "delegue" | "quand" | "note" | "info";

export interface Destin {
  id: string;
  kind: DestinKind;
  title: string;
  /** Voie adossée à un label Gmail : on peut y aiguiller un fil. */
  labelId?: string;
  items: ThreadListItem[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lit le destin que l'utilisateur a déjà codé dans le nom de ses labels (« voir avec paul », « codir », « todo melvin »…). */
export function classifyLabel(name: string): { kind: DestinKind; title: string } | null {
  const n = name.trim();
  if (/^(todo\/\d|supernote\/)/i.test(n)) return null;
  const avec = /^voir avec\s+(.+)$/i.exec(n);
  if (avec) return { kind: "avec", title: cap(avec[1]!) };
  const todo = /^todo\s+(.+)$/i.exec(n);
  if (todo && !/^perso$/i.test(todo[1]!)) return { kind: "delegue", title: cap(todo[1]!) };
  if (/(codir|coger|daily|copil|cse|1-1|entretien|r[ée]union|comit[ée]|hebdo)/i.test(n)) return { kind: "reunion", title: cap(n) };
  if (/d[ée]veloppement/i.test(n)) return { kind: "delegue", title: cap(n.replace(/d[ée]veloppement/i, "dév")) };
  if (/(week-?end|urgent|[àa] faire|r[ée]pondre|demain|semaine)/i.test(n)) return { kind: "quand", title: cap(n) };
  return null;
}

const KIND_HUE: Partial<Record<DestinKind, number>> = { lot: 190, reunion: 215, delegue: 150, quand: 45, note: 265 };

/** Couleur d'une voie : la teinte de la personne pour « avec X », une teinte fixe par nature sinon. */
export function voieColor(kind: DestinKind, title: string): string {
  if (kind === "repondre") return "var(--sn-ember)";
  if (kind === "avec") return `hsl(${senderHue(title)} 70% 50%)`;
  const hue = KIND_HUE[kind];
  return hue === undefined ? "var(--text-muted)" : `hsl(${hue} 60% 52%)`;
}

const KIND_ORDER: DestinKind[] = ["libre", "repondre", "lot", "avec", "reunion", "delegue", "quand", "note", "info"];
const LOT_MIN_SENDERS = 3;

/** Mot-sujet partagé par plusieurs expéditeurs (« Matrice » reçu de 5 collègues) : un lot à traiter d'un bloc. */
function findLots(items: ThreadListItem[]): Map<string, ThreadListItem[]> {
  const byWord = new Map<string, Map<string, ThreadListItem>>();
  for (const it of items) {
    const words = new Set(it.subject.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z]{6,}/g) ?? []);
    for (const w of words) {
      const m = byWord.get(w) ?? new Map<string, ThreadListItem>();
      m.set(it.from.email.toLowerCase(), it);
      byWord.set(w, m);
    }
  }
  const lots = new Map<string, ThreadListItem[]>();
  const used = new Set<string>();
  // Un mot présent partout (le nom de la société) ne distingue rien.
  const ceiling = Math.max(LOT_MIN_SENDERS, items.length * 0.4);
  for (const [w, m] of [...byWord].sort((a, b) => b[1].size - a[1].size)) {
    if (m.size < LOT_MIN_SENDERS || m.size > ceiling) continue;
    const fresh = [...m.values()].filter((it) => !used.has(it.id));
    if (fresh.length < LOT_MIN_SENDERS) continue;
    fresh.forEach((it) => used.add(it.id));
    lots.set(w, fresh);
  }
  return lots;
}

/** Range chaque fil sur UNE voie. Le choix de l'utilisateur (label) prime sur toute déduction. */
export function buildDestins(
  items: readonly ThreadListItem[],
  labelNames: ReadonlyMap<string, string>,
  selfEmails: readonly string[],
): Destin[] {
  const byId = new Map<string, Destin>();
  const voie = (id: string, kind: DestinKind, title: string, labelId?: string): Destin => {
    let d = byId.get(id);
    if (!d) byId.set(id, (d = { id, kind, title, items: [], ...(labelId ? { labelId } : {}) }));
    return d;
  };
  const labelVoies = new Map<string, Destin>();
  for (const [labelId, name] of labelNames) {
    const c = classifyLabel(name);
    if (c) labelVoies.set(labelId, voie(`l:${labelId}`, c.kind, c.title, labelId));
  }
  const libre = voie("libre", "libre", "À aiguiller");
  const repondre = voie("repondre", "repondre", "À répondre");
  const note = voie("note", "note", "Notes à moi");
  const info = voie("info", "info", "Pour info");

  const undecided: ThreadListItem[] = [];
  for (const it of items) {
    const chosen = it.labelIds
      .map((l) => labelVoies.get(l))
      .filter((d): d is Destin => Boolean(d))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))[0];
    if (chosen) chosen.items.push(it);
    else if (isSelfAddress(it.from.email, selfEmails)) note.items.push(it);
    else if (isMachineAddress(it.from.email) || it.labelIds.some((l) => l.startsWith("CATEGORY_") && l !== "CATEGORY_PERSONAL")) info.items.push(it);
    else undecided.push(it);
  }
  const lots = findLots(undecided);
  const inLot = new Set<string>();
  for (const [w, lot] of lots) {
    voie(`lot:${w}`, "lot", cap(w)).items.push(...lot);
    lot.forEach((it) => inLot.add(it.id));
  }
  for (const it of undecided) {
    if (inLot.has(it.id)) continue;
    (awaitsMyReply(it, selfEmails) ? repondre : libre).items.push(it);
  }
  return [...byId.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.items.length - a.items.length || a.title.localeCompare(b.title),
  );
}

console.assert(classifyLabel("voir avec aurelia")?.title === "Aurelia" && classifyLabel("todo melvin")?.kind === "delegue");
console.assert(classifyLabel("CSE-todo")?.kind === "reunion" && classifyLabel("Factures") === null && classifyLabel("Todo/1 Faire") === null);
