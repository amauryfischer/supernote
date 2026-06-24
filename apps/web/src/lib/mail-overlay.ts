import type { ThreadListItem } from "@/lib/gmail";

export type OverlayRow =
  | { kind: "single"; item: ThreadListItem }
  | {
      kind: "group";
      groupType: "label" | "sender";
      key: string;
      title: string;
      count: number;
      items: ThreadListItem[];
      date: string;
    };

function mostRecent(items: ThreadListItem[]): string {
  return items.reduce((max, it) => (it.date > max ? it.date : max), "");
}

/**
 * Surcouche de regroupement. Label d'abord (≥2 items partageant un label user),
 * puis expéditeur (≥2 items restants même from.email), puis lignes seules. Tri
 * par date la plus récente. Pur & déterministe.
 *
 * `userLabels` : map labelId → nom (labels user uniquement). Un item multi-label
 * rejoint le plus gros groupe-label (tie-break : taille desc, puis nom asc).
 */
export function buildMailOverlay(
  items: ThreadListItem[],
  userLabels: Map<string, string>,
): OverlayRow[] {
  const consumed = new Set<string>();

  // 1. Indexer par label user.
  const byLabel = new Map<string, ThreadListItem[]>();
  for (const it of items) {
    for (const lid of it.labelIds) {
      if (!userLabels.has(lid)) continue;
      const arr = byLabel.get(lid);
      if (arr) arr.push(it);
      else byLabel.set(lid, [it]);
    }
  }
  // Candidats label (≥2), triés par taille desc puis nom asc → un item multi-label
  // tombe dans le plus gros groupe traité en premier.
  const labelGroups = [...byLabel.entries()]
    .filter(([, arr]) => arr.length >= 2)
    .sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return userLabels.get(a[0])! < userLabels.get(b[0])! ? -1 : 1;
    });

  const rows: OverlayRow[] = [];
  for (const [lid, candidates] of labelGroups) {
    const members = candidates.filter((it) => !consumed.has(it.id));
    if (members.length < 2) continue;
    members.forEach((it) => consumed.add(it.id));
    rows.push({
      kind: "group",
      groupType: "label",
      key: `label:${lid}`,
      title: userLabels.get(lid)!,
      count: members.length,
      items: members,
      date: mostRecent(members),
    });
  }

  // 2. Groupes-expéditeur sur le reste.
  const bySender = new Map<string, ThreadListItem[]>();
  for (const it of items) {
    if (consumed.has(it.id)) continue;
    const key = it.from.email || it.from.name;
    // From illisible (name+email vides) → ne pas regrouper sous une clé "" :
    // ça fusionnerait des expéditeurs distincts en un faux groupe sans titre.
    // On laisse ces items tomber en lignes seules.
    if (!key) continue;
    const arr = bySender.get(key);
    if (arr) arr.push(it);
    else bySender.set(key, [it]);
  }
  for (const [email, arr] of bySender.entries()) {
    if (arr.length < 2) continue;
    arr.forEach((it) => consumed.add(it.id));
    rows.push({
      kind: "group",
      groupType: "sender",
      key: `sender:${email}`,
      title: arr[0]!.from.name || email,
      count: arr.length,
      items: arr,
      date: mostRecent(arr),
    });
  }

  // 3. Lignes seules.
  for (const it of items) {
    if (!consumed.has(it.id)) rows.push({ kind: "single", item: it });
  }

  // 4. Tri par date desc.
  const rowDate = (r: OverlayRow) => (r.kind === "single" ? r.item.date : r.date);
  return rows.sort((a, b) => (rowDate(a) < rowDate(b) ? 1 : -1));
}
