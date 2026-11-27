/**
 * Passages surlignés d'un mail, peints par l'API CSS Custom Highlight : aucun nœud
 * ajouté au corps (HTML sanitizé ou texte brut), donc rien à resanitizer ni à défaire.
 */
export const MAIL_MARK = "sn-mail-mark";

type HighlightWindow = Window & typeof globalThis;

/**
 * Plages des passages dans `root`, première occurrence de chacun. Blancs fusionnés et
 * casse ignorée : la sélection (toString) et le texte rendu ne coupent pas les lignes pareil.
 */
export function findTextRanges(root: Node, needles: readonly string[]): Range[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const at: Array<{ node: Text; offset: number }> = [];
  let flat = "";
  let lastSpace = true;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i]!;
      const space = /\s/.test(ch);
      if (space && lastSpace) continue;
      // Un seul caractère par position : la table `at` reste alignée sur `flat`.
      flat += space ? " " : ch.toLowerCase()[0]!;
      at.push({ node: n, offset: i });
      lastSpace = space;
    }
  }
  const ranges: Range[] = [];
  for (const needle of needles) {
    const q = needle.replace(/\s+/g, " ").trim().toLowerCase();
    const from = q ? flat.indexOf(q) : -1;
    if (from < 0) continue;
    const start = at[from]!;
    const end = at[from + q.length - 1]!;
    const r = doc.createRange();
    r.setStart(start.node, start.offset);
    r.setEnd(end.node, end.offset + 1);
    ranges.push(r);
  }
  return ranges;
}

/** Peint les plages dans le registre de `win` (chaque iframe a le sien) ; renvoie de quoi les retirer. */
export function paintHighlights(win: Window | null | undefined, ranges: Range[]): () => void {
  const w = win as HighlightWindow | null | undefined;
  const registry = w?.CSS?.highlights;
  if (!w || !registry || typeof w.Highlight !== "function" || ranges.length === 0) return () => {};
  let mark = registry.get(MAIL_MARK);
  if (!mark) {
    mark = new w.Highlight();
    registry.set(MAIL_MARK, mark);
  }
  for (const r of ranges) mark.add(r);
  return () => {
    for (const r of ranges) mark.delete(r);
  };
}

/** Texte sélectionné s'il se trouve entièrement dans `root`, sinon "". */
export function selectionWithin(root: Node | null, selection: Selection | null): string {
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return "";
  const r = selection.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return "";
  return selection.toString().replace(/\s+/g, " ").trim();
}
