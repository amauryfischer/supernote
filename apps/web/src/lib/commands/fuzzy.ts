/**
 * Lightweight fuzzy scorer.
 * Returns a score >= 0 (higher is better match). Returns -1 for no match.
 *
 * Strategy:
 *  1. Exact prefix of the label → highest bonus
 *  2. All query chars appear in order in target → sequential match
 *  3. Levenshtein-style tolerance for typos (small strings only)
 */

/** Check if all characters in `query` appear in `target` in order. */
function isSubsequence(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/** Simple Levenshtein distance (bounded at maxDist for performance). */
function levenshtein(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val =
        a[i - 1] === b[j - 1]
          ? row[j - 1]!
          : 1 + Math.min(prev, row[j]!, row[j - 1]!);
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length]!;
}

export function fuzzyScore(query: string, label: string, keywords: string[] = []): number {
  if (!query) return 100; // empty query matches everything with neutral score
  const q = query.toLowerCase();
  const l = label.toLowerCase();

  // Exact match
  if (l === q) return 1000;

  // Prefix match
  if (l.startsWith(q)) return 800 + (q.length / l.length) * 200;

  // Contains match
  const idx = l.indexOf(q);
  if (idx !== -1) return 600 + (q.length / l.length) * 200;

  // Keyword boost: check if any keyword starts with or contains query
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k.startsWith(q)) return 550;
    if (k.includes(q)) return 450;
  }

  // Subsequence match
  if (isSubsequence(q, l)) return 400 + (q.length / l.length) * 100;

  // Levenshtein tolerance (only for short queries)
  if (q.length >= 3 && l.length <= 30) {
    const dist = levenshtein(q, l.slice(0, q.length + 2), 2);
    if (dist <= 2) return 200 - dist * 50;
  }

  return -1; // no match
}
