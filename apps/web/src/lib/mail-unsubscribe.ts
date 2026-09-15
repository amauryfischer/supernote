/**
 * mail-unsubscribe — désabonnement en un clic.
 *
 * Deux sources, dans cet ordre de confiance :
 *  1. l'en-tête `List-Unsubscribe` (RFC 2369) et son compagnon
 *     `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) — c'est le
 *     chemin prévu par la norme, celui qui ne demande RIEN à l'utilisateur ;
 *  2. à défaut, un lien « se désabonner » repéré dans le corps HTML — moins
 *     fiable, donc on l'OUVRE dans un onglet au lieu de cliquer à l'aveugle.
 *
 * L'en-tête n'est pas mirroré (le mirror ne stocke pas les en-têtes bruts) : il
 * est lu à la demande, au moment où l'utilisateur agit. Le repérage HTML, lui,
 * est PUR et fonctionne hors ligne.
 *
 * Limite honnête du POST « un clic » depuis un navigateur : la requête part en
 * `no-cors`, donc la réponse est opaque — on peut confirmer l'ENVOI, pas la
 * prise en compte. C'est dit dans l'UI.
 */

/** Cibles de désabonnement extraites d'un message. */
export interface UnsubscribeTargets {
  /** URL https de désabonnement (en-tête ou lien du corps). */
  url?: string;
  /** Adresse mailto de désabonnement (en-tête). */
  mailto?: string;
  /** Objet suggéré pour le mailto (paramètre `?subject=`). */
  mailtoSubject?: string;
  /** Le serveur accepte le POST « un clic » (RFC 8058). */
  oneClick: boolean;
  /** D'où vient l'info : en-tête normalisé, ou lien deviné dans le corps. */
  source: "header" | "body";
}

/**
 * Analyse un en-tête `List-Unsubscribe` : une liste de cibles entre chevrons,
 * séparées par des virgules (`<https://…>, <mailto:…>`). PUR.
 */
export function parseListUnsubscribeHeader(
  header: string,
  postHeader?: string,
): UnsubscribeTargets | null {
  const raw = (header ?? "").trim();
  if (!raw) return null;
  const targets: UnsubscribeTargets = {
    oneClick: /one-?click/i.test(postHeader ?? ""),
    source: "header",
  };
  for (const m of raw.matchAll(/<([^>]+)>/g)) {
    const value = (m[1] ?? "").trim();
    if (/^https?:\/\//i.test(value)) {
      targets.url ??= value;
      continue;
    }
    if (/^mailto:/i.test(value)) {
      const withoutScheme = value.slice("mailto:".length);
      const [address, query] = withoutScheme.split("?");
      targets.mailto ??= address;
      if (query) {
        const subject = new URLSearchParams(query).get("subject");
        if (subject) targets.mailtoSubject ??= subject;
      }
    }
  }
  return targets.url || targets.mailto ? targets : null;
}

/** Mots qui désignent un lien de désabonnement, toutes langues usuelles. */
const UNSUB_WORDS =
  /(d[ée]sabonn|desinscri|désinscri|unsubscribe|opt[\s-]?out|se d[ée]sinscrire|abmelden|cancelar\s+suscrip)/i;

/**
 * Repère un lien de désabonnement dans un corps HTML : on parcourt les ancres
 * et on retient la première dont le texte OU l'URL évoque un désabonnement.
 *
 * Analyse par `DOMParser` plutôt qu'à coups d'expressions régulières sur le
 * HTML : le document est inerte (aucun script, aucune ressource chargée) et on
 * ne lit que `href` et le texte. PUR au sens « aucun effet de bord ».
 */
export function findUnsubscribeLinkInHtml(html: string | undefined): string | null {
  if (!html || typeof window === "undefined" || typeof DOMParser === "undefined") return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) continue;
    const text = (a.textContent ?? "").trim();
    if (UNSUB_WORDS.test(text) || UNSUB_WORDS.test(href)) return href;
  }
  return null;
}

/** Cibles déduites du seul corps du message (chemin hors ligne). PUR. */
export function unsubscribeFromBody(html: string | undefined): UnsubscribeTargets | null {
  const url = findUnsubscribeLinkInHtml(html);
  return url ? { url, oneClick: false, source: "body" } : null;
}

/**
 * Exécute le désabonnement « un clic » (RFC 8058). La requête part en
 * `no-cors` : elle EST envoyée, mais la réponse est opaque — on ne peut donc
 * pas confirmer la prise en compte, seulement l'envoi. Renvoie `false` si le
 * réseau a refusé la requête.
 */
export async function postOneClickUnsubscribe(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    return true;
  } catch {
    return false;
  }
}
