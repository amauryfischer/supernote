import { DAY_MS, minutesOfDay } from "./dates";

export interface PlacedEvent<T> {
  item: T;
  top: number;
  height: number;
  column: number;
  columns: number;
}

/** Un événement de 5 min reste cliquable. */
const MIN_HEIGHT_MIN = 20;

/**
 * Place les événements d'une journée : ceux qui se chevauchent partagent la
 * largeur en colonnes, attribuées de façon gloutonne dans chaque groupe.
 */
export function layoutDay<T extends { startAt: number; endAt: number }>(
  items: T[],
  dayStart: number,
  pxPerMinute: number,
): PlacedEvent<T>[] {
  const dayEnd = dayStart + DAY_MS;
  const spans = items
    .map((item) => {
      const startMin = item.startAt <= dayStart ? 0 : minutesOfDay(item.startAt);
      const endMin = item.endAt >= dayEnd ? 24 * 60 : minutesOfDay(item.endAt);
      return { item, startMin, endMin: Math.max(endMin, startMin + MIN_HEIGHT_MIN) };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const placed: PlacedEvent<T>[] = [];
  let cluster: { span: (typeof spans)[number]; column: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = cluster.reduce((max, c) => Math.max(max, c.column + 1), 1);
    for (const c of cluster) {
      placed.push({
        item: c.span.item,
        top: c.span.startMin * pxPerMinute,
        height: (c.span.endMin - c.span.startMin) * pxPerMinute,
        column: c.column,
        columns,
      });
    }
    cluster = [];
  };
  for (const span of spans) {
    if (span.startMin >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => c.span.endMin > span.startMin).map((c) => c.column));
    let column = 0;
    while (taken.has(column)) column++;
    cluster.push({ span, column });
    clusterEnd = Math.max(clusterEnd, span.endMin);
  }
  flush();
  return placed;
}
