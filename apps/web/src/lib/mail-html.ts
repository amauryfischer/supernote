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
 *  - Ressources distantes (images, `background`, `url()` du CSS inline, `<svg
 *    image>`) retirées par défaut : ce sont les pixels-espions qui signalent
 *    l'ouverture. Le lecteur les réaffiche à la demande (`allowRemoteImages`),
 *    ou pour toujours par expéditeur (`trustImageSender`).
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
// Lus par le hook, global à DOMPurify (d'autres modules l'utilisent) : armés
// uniquement le temps d'un `sanitizeEmailHtml`, qui est synchrone.
let blockRemote = false;
let blockedCount = 0;

/** Tout ce qui n'est pas embarqué dans le message (`data:`) ou une pièce jointe (`cid:`). */
function isRemoteUrl(value: string): boolean {
  const v = value.trim();
  return v !== "" && !/^(data|cid):/i.test(v);
}

const REMOTE_URL_ATTRS = ["src", "srcset", "poster", "background"];

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
    if (blockRemote && /(url|image-set)\(\s*(?!['"]?\s*data:)/i.test(value)) {
      blockedCount++;
      continue;
    }
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
    const tag = node.tagName.toUpperCase();
    if (tag === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (blockRemote) {
      const attrs = tag === "A" || tag === "AREA" ? REMOTE_URL_ATTRS : [...REMOTE_URL_ATTRS, "href", "xlink:href"];
      for (const name of attrs) {
        const value = node.getAttribute(name);
        if (value !== null && isRemoteUrl(value)) {
          node.removeAttribute(name);
          blockedCount++;
        }
      }
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

/**
 * Conteneurs de signature posés par les clients courants (Outlook `#Signature`,
 * `#x_Signature` en réponse ; Gmail ; Apple Mail ; Thunderbird ; Proton).
 */
const SIGNATURE_SELECTOR =
  "[id='Signature' i], [id$='_Signature' i], .gmail_signature, .gmail_signature_prefix, [data-smartmail='gmail_signature'], #AppleMailSignature, .moz-signature, .protonmail_signature_block";

/**
 * Sépare un corps HTML DÉJÀ sanitizé (et déjà privé de sa citation) de sa
 * signature, repérée uniquement par les marqueurs des clients (cf.
 * `SIGNATURE_SELECTOR`). Sans marqueur, ou si la signature engloberait tout le
 * texte, le corps reste intact.
 */
export function splitSignatureHtml(html: string): { body: string; signature: string } {
  if (!html || typeof DOMParser === "undefined") return { body: html, signature: "" };
  const root = new DOMParser().parseFromString(html, "text/html").body;
  const parts: string[] = [];
  for (const el of root.querySelectorAll(SIGNATURE_SELECTOR)) {
    if (!el.isConnected) continue;
    parts.push(el.outerHTML);
    el.remove();
  }
  if (parts.length === 0 || (root.textContent ?? "").trim() === "") return { body: html, signature: "" };
  return { body: root.innerHTML.trim(), signature: parts.join("") };
}

/**
 * `blockedImages` compte les ressources distantes retirées : le lecteur ne
 * propose « Afficher les images » que s'il y a quelque chose à afficher.
 */
export function sanitizeEmailHtml(
  dirty: string,
  { allowRemoteImages = false }: { allowRemoteImages?: boolean } = {},
): { html: string; blockedImages: number } {
  if (!dirty) return { html: "", blockedImages: 0 };
  ensureLinkHook();
  blockRemote = !allowRemoteImages;
  blockedCount = 0;
  let html: string;
  try {
    html = DOMPurify.sanitize(dirty, {
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
  } finally {
    blockRemote = false;
  }
  return { html, blockedImages: blockedCount };
}

// ── Expéditeurs dont les images s'affichent d'office ─────────────────────────
const IMAGE_SENDERS_KEY = "supernote.mail.imageSenders";
export const MAIL_IMAGE_SENDERS_EVENT = "supernote:mail-image-senders";
let imageSenders: Set<string> | null = null;

export function loadImageSenders(): Set<string> {
  if (imageSenders) return imageSenders;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(IMAGE_SENDERS_KEY) ?? "[]");
    imageSenders = new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    imageSenders = new Set();
  }
  return imageSenders;
}

function saveImageSenders(next: Set<string>): void {
  imageSenders = next;
  try {
    window.localStorage.setItem(IMAGE_SENDERS_KEY, JSON.stringify([...next]));
  } catch {
    /* quota / storage désactivé — le choix vaut pour la session */
  }
  window.dispatchEvent(new CustomEvent(MAIL_IMAGE_SENDERS_EVENT));
}

export function trustImageSender(email: string): void {
  const key = email.trim().toLowerCase();
  if (!key || loadImageSenders().has(key)) return;
  saveImageSenders(new Set([...loadImageSenders(), key]));
}

export function untrustImageSender(email: string): void {
  const next = new Set(loadImageSenders());
  if (next.delete(email.trim().toLowerCase())) saveImageSenders(next);
}
