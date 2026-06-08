/**
 * Unsplash — recherche de photos pour les couvertures de note.
 *
 * Clé d'accès via `VITE_UNSPLASH_ACCESS_KEY` (https://unsplash.com/developers).
 * L'API Unsplash renvoie ses propres en-têtes CORS quand on authentifie par
 * `client_id` en query string, donc pas besoin de proxy côté navigateur
 * (contrairement aux quotes finance, cf. `lib/finance/price-fetch.ts`).
 *
 * Dégradé : sans clé, `hasUnsplashKey()` est faux et `searchUnsplash` rend un
 * tableau vide — l'UI affiche alors un message au lieu de planter.
 *
 * Conformité ToS Unsplash : on déclenche l'endpoint `download_location` quand
 * une photo est réellement utilisée (cf. `triggerUnsplashDownload`) et on
 * crédite le photographe dans le sélecteur.
 */

const ACCESS_KEY = import.meta.env.VITE_UNSPLASH_ACCESS_KEY;
const API = "https://api.unsplash.com";

export interface UnsplashPhoto {
  id: string;
  /** Vignette légère pour la grille du sélecteur. */
  thumbUrl: string;
  /** URL dimensionnée stockée comme fond de couverture. */
  coverUrl: string;
  alt: string;
  authorName: string;
  authorUrl: string;
  downloadLocation: string;
}

/** Vrai si une clé d'accès Unsplash est configurée. */
export function hasUnsplashKey(): boolean {
  return typeof ACCESS_KEY === "string" && ACCESS_KEY.length > 0;
}

interface RawPhoto {
  id: string;
  alt_description: string | null;
  urls: { raw: string; small: string; thumb: string };
  links: { download_location: string };
  user: { name: string; links: { html: string } };
}

function toPhoto(p: RawPhoto): UnsplashPhoto {
  // `raw` + paramètres Imgix → fond net, taille raisonnable pour une couverture.
  const sized = `${p.urls.raw}&w=1600&q=80&auto=format&fit=crop`;
  return {
    id: p.id,
    thumbUrl: p.urls.small,
    coverUrl: sized,
    alt: p.alt_description ?? "Photo Unsplash",
    authorName: p.user.name,
    authorUrl: p.user.links.html,
    downloadLocation: p.links.download_location,
  };
}

/**
 * Recherche des photos paysage. Requête vide → sélection aléatoire (curated).
 * Lève en cas d'erreur réseau/HTTP pour que l'appelant affiche un état d'erreur.
 */
export async function searchUnsplash(
  query: string,
  signal?: AbortSignal,
): Promise<UnsplashPhoto[]> {
  if (!hasUnsplashKey()) return [];
  const q = query.trim();
  const url = q
    ? `${API}/search/photos?query=${encodeURIComponent(q)}&per_page=24&orientation=landscape&content_filter=high&client_id=${ACCESS_KEY}`
    : `${API}/photos/random?count=24&orientation=landscape&content_filter=high&client_id=${ACCESS_KEY}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Unsplash ${res.status}`);
  const json: unknown = await res.json();
  const list = Array.isArray(json)
    ? (json as RawPhoto[])
    : ((json as { results?: RawPhoto[] }).results ?? []);
  return list.map(toPhoto);
}

/**
 * Notifie Unsplash qu'une photo est utilisée (requis par leurs guidelines API).
 * Fire-and-forget : aucune erreur ne doit bloquer la pose de la couverture.
 */
export function triggerUnsplashDownload(photo: UnsplashPhoto): void {
  if (!hasUnsplashKey()) return;
  void fetch(`${photo.downloadLocation}&client_id=${ACCESS_KEY}`).catch(() => {
    /* best-effort : ignore les échecs */
  });
}
