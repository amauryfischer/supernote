/**
 * Garde commune aux écrivains du `.md` hors éditeur : en co-édition, l'état Yjs
 * fait foi et réécrit le corps, donc toute écriture faite ailleurs est perdue
 * sans message à la réconciliation.
 */

export function isSharedNote(fields: Record<string, unknown>): boolean {
  const shareId = fields["shareId"];
  return typeof shareId === "string" && shareId !== "";
}

export function refuseIfShared(fields: Record<string, unknown>, message: string): void {
  if (isSharedNote(fields)) throw new Error(message);
}
