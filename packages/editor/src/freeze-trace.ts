// Breadcrumb minimal côté éditeur pour le watchdog anti-freeze de l'app.
//
// L'app (apps/web) instrumente déjà les surfaces (route, edit:note…) via
// son freeze-watchdog. Mais quand le thread principal gèle PENDANT un handler
// onChange interne de l'éditeur, le dernier crumb « edit:note » ne dit pas
// LEQUEL. Ce module écrit la MÊME clé localStorage (`sn:freeze:crumb`) avec la
// même forme `{label, t}`, donc FreezeReportBanner l'affiche tel quel — sans
// que packages/editor ait à dépendre de apps/web (dépendance interdite dans ce
// sens). À placer juste avant les hotspots sync de l'éditeur ; le dernier label
// écrit avant le gel nomme le handler fautif.

const CRUMB_KEY = "sn:freeze:crumb";

let lastWritten: string | null = null;

/** Marque le hotspot éditeur courant. Écrit seulement au changement de label. */
export function trace(label: string): void {
  if (label === lastWritten) return;
  lastWritten = label;
  try {
    localStorage.setItem(CRUMB_KEY, JSON.stringify({ label, t: Date.now() }));
  } catch {
    /* SSR / mode privé / quota — best-effort */
  }
}
