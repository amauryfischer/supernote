/** Lignes parcourables au clavier : tout élément focalisable marqué `data-kb-item`. */
const listItems = () =>
  [...document.querySelectorAll<HTMLElement>("[data-kb-item]:not(:disabled):not([aria-disabled=true])")].filter(
    (el) => !el.closest("[inert]") && el.getClientRects().length > 0,
  );

/** Déplace le focus de `step` lignes ; `false` si la page n'a pas de liste (la touche reste libre). */
export function moveListCursor(step: number): boolean {
  const items = listItems();
  if (!items.length) return false;
  const at = items.findIndex((el) => el.contains(document.activeElement));
  const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, at + step));
  const el = items[next];
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: "nearest" });
  return true;
}
