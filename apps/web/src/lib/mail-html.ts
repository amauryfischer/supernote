/**
 * Sanitization du corps HTML d'un e-mail (chemin `bodyHtml`) via DOMPurify.
 *
 * Le corps HTML brut d'un mail est une surface XSS majeure (scripts, handlers
 * `on*`, `<style>` exfiltrant, `javascript:` URIs, iframes…). On ne le rend
 * JAMAIS tel quel : `sanitizeEmailHtml` produit une chaîne HTML nettoyée,
 * destinée à `dangerouslySetInnerHTML` dans un conteneur isolé (voir
 * `EmailThreadView`/MessageBubble).
 *
 * Politique stricte :
 *  - pas de `<script>` ni `<style>` (FORBID_TAGS) — pas d'exécution, pas de CSS
 *    global exfiltrant ;
 *  - pas d'attributs `on*` (DOMPurify les retire par défaut ; explicité par
 *    FORBID_ATTR pour la lisibilité) ;
 *  - pas de `<form>`/`<input>` ni de contenu interactif soumettable ;
 *  - tous les liens `<a>` forcés en `target="_blank" rel="noopener noreferrer"`
 *    (hook `afterSanitizeAttributes`) → ouverture externe sûre, pas de
 *    `window.opener` exploitable, pas de navigation dans la SPA.
 *
 * Limites connues (documentées) :
 *  - Images inline `cid:` (référencées par Content-ID dans le HTML) ne sont PAS
 *    résolues : on les laisse passer (best-effort) ; elles ne chargeront pas
 *    (URL `cid:` non gérée par le navigateur) mais ne plantent pas le rendu.
 *  - Pas de proxy d'images distantes : les pixels-espions `<img src="https://…">`
 *    peuvent charger (tracking d'ouverture). Acceptable en l'état ; un blocage
 *    images distantes serait une amélioration future.
 *  - Le CSS inline (`style="…"`) reste autorisé par défaut pour préserver la
 *    mise en forme ; il est borné côté conteneur (max-width, overflow) mais peut
 *    déborder visuellement. DOMPurify neutralise les `style` dangereux
 *    (expression(), url(javascript:)…). En complément, on RETIRE le CSS de mise
 *    en page hors-flux (`position: fixed/absolute/sticky`, `z-index`,
 *    `top/right/bottom/left`, `inset`) qui permettrait à un email de dessiner un
 *    overlay plein écran captant les clics (clickjacking) — voir
 *    `sanitizeLayoutStyle`. Les déclarations bénignes (couleurs/typo) sont
 *    conservées.
 */

import DOMPurify from "dompurify";

let hookRegistered = false;

/**
 * Propriétés CSS de positionnement retirées inconditionnellement d'un `style`
 * inline : sans positionnement hors-flux elles sont sans effet, mais combinées à
 * `position` elles servent à construire un overlay (clickjacking). On les retire
 * donc systématiquement. `position` est traité à part (seules les valeurs
 * hors-flux fixed/absolute/sticky sont retirées ; relative/static restent).
 */
const BLOCKED_LAYOUT_PROPS = new Set([
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
]);

/**
 * Neutralise le CSS de mise en page dangereux d'un attribut `style` inline
 * (chaîne `prop: val; …`). Retire `position` hors-flux (fixed/absolute/sticky) et
 * toutes les propriétés de `BLOCKED_LAYOUT_PROPS` ; conserve le reste à
 * l'identique (couleurs, typo…). Traitement chaîne (indépendant du CSSOM) pour
 * rester robuste quel que soit le moteur (jsdom/navigateur). Renvoie la chaîne
 * de style nettoyée (éventuellement vide). Pur.
 */
function sanitizeLayoutStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!prop || !value) continue;
    if (prop === "position") {
      const v = value.toLowerCase();
      if (v === "fixed" || v === "absolute" || v === "sticky") continue;
    } else if (BLOCKED_LAYOUT_PROPS.has(prop)) {
      continue;
    }
    kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}

/**
 * Enregistre (une seule fois) le hook `afterSanitizeAttributes` qui (1) force des
 * attributs de lien sûrs (`target=_blank` + `rel`) et (2) neutralise le CSS de
 * mise en page dangereux des `style` inline (anti-clickjacking, cf.
 * `sanitizeLayoutStyle`). Idempotent : un flag évite d'empiler le hook.
 */
function ensureLinkHook(): void {
  if (hookRegistered) return;
  hookRegistered = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (node.hasAttribute("style")) {
      const cleaned = sanitizeLayoutStyle(node.getAttribute("style") ?? "");
      if (cleaned) node.setAttribute("style", cleaned);
      else node.removeAttribute("style");
    }
  });
}

/**
 * Nettoie une chaîne HTML d'e-mail et renvoie du HTML sûr (string) prêt pour
 * `dangerouslySetInnerHTML`. Config stricte (cf. doc module). Pur du point de
 * vue de l'appelant (pas d'effet de bord observable hors enregistrement unique
 * du hook DOMPurify). Renvoie `""` pour une entrée vide.
 */
/**
 * Conteneurs de citation reconnus par les clients courants (Gmail, Yahoo,
 * ProtonMail, Outlook `#appendonsend`, Thunderbird `.moz-cite-prefix`).
 */
const QUOTE_SELECTOR =
  "blockquote, .gmail_quote, [class*='gmail_quote'], .gmail_extra, .yahoo_quoted, .protonmail_quote, #appendonsend, .moz-cite-prefix";

/** Ligne d'attribution (« … a écrit : » / « … wrote: ») terminant un paragraphe. */
const HTML_ATTR_RE = /\b(?:wrote|a[\s ]+[ée]crit|[ée]crit)\s*:?\s*$/i;

/**
 * Sépare un corps HTML d'e-mail DÉJÀ sanitizé en { body, quoted } : le contenu
 * « neuf » vs l'historique cité (chaîne de réponses/transfert). Coupe au PREMIER
 * conteneur de citation (cf. `QUOTE_SELECTOR`), en incluant une éventuelle ligne
 * d'attribution juste avant ; tout ce qui suit part dans `quoted`. Sans marqueur
 * → tout reste `body`. Opère sur du HTML déjà nettoyé (donc `quoted` reste sûr).
 * Pur (DOMParser, pas d'effet de bord). En l'absence de DOMParser → no-op.
 */
export function splitQuotedHtml(html: string): { body: string; quoted: string } {
  if (!html || typeof DOMParser === "undefined") return { body: html, quoted: "" };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return { body: html, quoted: "" };
  }
  const root = doc.body;
  const q = root.querySelector(QUOTE_SELECTOR);
  if (!q) return { body: html, quoted: "" };

  // Point de coupe = le bloc cité À SON PROPRE NIVEAU (et non remonté jusqu'à
  // l'enfant direct de <body>). Inclut une ligne d'attribution (« … a écrit : »)
  // juste avant. Crucial : si le contenu NEUF et la citation partagent un même
  // wrapper (`<div dir="auto">…texte…<blockquote>…`, courant chez Outlook/Apple
  // Mail/Gmail mobile), remonter au top-level engloutirait le texte neuf → corps
  // vide. On coupe donc l'arbre en document-order à ce nœud.
  let start: Node = q;
  let prev: Node | null = q.previousSibling;
  while (prev && prev.nodeType === 3 && (prev.textContent ?? "").trim() === "") {
    prev = prev.previousSibling;
  }
  if (prev && prev.nodeType === 1 && HTML_ATTR_RE.test((prev.textContent ?? "").trim())) {
    start = prev;
  }

  // Y a-t-il du contenu « neuf » AVANT `node` dans son parent ? (texte non vide
  // ou image — ex. logo de signature). Si oui, on s'arrête : ce parent garde le
  // contenu neuf. Sinon le parent n'enveloppe que la citation → on l'absorbe
  // (évite de laisser un wrapper vide dans le corps).
  const hasContentBefore = (node: Node): boolean => {
    for (let s = node.previousSibling; s; s = s.previousSibling) {
      if ((s.textContent ?? "").trim() !== "") return true;
      if (s.nodeType === 1 && (s as Element).querySelector("img")) return true;
    }
    return false;
  };
  while (start.parentElement && start.parentElement !== root && !hasContentBefore(start)) {
    start = start.parentElement;
  }

  // Collecte en document-order tout ce qui est À/APRÈS `start` : au niveau
  // courant `start` + ses suivants ; puis on monte et on prend les frères
  // suivants de chaque ancêtre (leur contenu AVANT `start` reste dans le corps).
  const quotedNodes: Node[] = [];
  let node: Node | null = start;
  let includeSelf = true;
  while (node && node !== root) {
    for (let s: Node | null = includeSelf ? node : node.nextSibling; s; s = s.nextSibling) {
      quotedNodes.push(s);
    }
    node = node.parentElement;
    includeSelf = false;
  }
  const serialize = (n: Node) =>
    n.nodeType === 1 ? (n as Element).outerHTML : n.textContent ?? "";
  const quoted = quotedNodes.map(serialize).join("");
  for (const n of quotedNodes) n.parentNode?.removeChild(n);
  return { body: root.innerHTML.trim(), quoted: quoted.trim() };
}

export function sanitizeEmailHtml(dirty: string): string {
  if (!dirty) return "";
  ensureLinkHook();
  return DOMPurify.sanitize(dirty, {
    // `<script>`/`<style>` (CSS global exfiltrant) + éléments interactifs/embed
    // qui n'ont aucun sens dans un corps de mail rendu en lecture.
    FORBID_TAGS: ["script", "style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
    // DOMPurify retire déjà tous les handlers `on*` ; on n'ajoute donc PAS
    // `style` ici → l'attribut `style` INLINE est conservé pour la mise en forme
    // du mail (DOMPurify neutralise les valeurs dangereuses : expression(),
    // url(javascript:)…). Le débordement visuel est borné côté conteneur.
    // Empêche le retour d'un TrustedHTML : on veut une string (compat React).
    RETURN_TRUSTED_TYPE: false,
    // Conserve le contenu textuel des éléments retirés plutôt que de tout jeter.
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: false,
  });
}
