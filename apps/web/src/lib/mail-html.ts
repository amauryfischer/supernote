/**
 * Sanitization du corps HTML d'un e-mail (chemin `bodyHtml`) via DOMPurify.
 *
 * Le corps HTML brut d'un mail est une surface XSS majeure (scripts, handlers
 * `on*`, `<style>` exfiltrant, `javascript:` URIs, iframes…). On ne le rend
 * JAMAIS tel quel : `sanitizeEmailHtml` produit une chaîne HTML nettoyée,
 * rendue dans une iframe sandboxée sans scripts (`MailHtmlFrame`, EmailThreadView).
 *
 * Politique stricte :
 *  - pas de `<script>` (FORBID_TAGS) ; `<style>` gardé, confiné à l'iframe ;
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
 *  - Ressources distantes (images, `background`, `url()`/`@import` du CSS, `<svg
 *    image>`) retirées si le réglage « Masquer les images distantes » est actif :
 *    ce sont les pixels-espions qui signalent l'ouverture. Le lecteur les réaffiche
 *    à la demande (`allowRemoteImages`), ou pour toujours par expéditeur
 *    (`trustImageSender`).
 *  - Le CSS inline (`style="…"`) reste autorisé pour préserver la mise en forme.
 *    DOMPurify neutralise les `style` dangereux
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
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (!blockRemote || data.tagName !== "style") return;
    const css = node.textContent ?? "";
    const cleaned = css
      .replace(/@import[^;]*;?/gi, () => (blockedCount++, ""))
      .replace(/(url|image-set)\(\s*(?!['"]?\s*data:)[^)]*\)/gi, () => (blockedCount++, "none"));
    if (cleaned !== css) node.textContent = cleaned;
  });
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
    html = DOMPurify.sanitize(hoistHead(dirty), {
      // `<style>` gardé : le corps est rendu dans une iframe sandboxée (`MailHtmlFrame`),
      // son CSS ne peut pas toucher l'app. Sans lui, les gabarits responsives cassent.
      FORBID_TAGS: ["script", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
      // Sinon un `<style>` en tête de corps part dans <head> et est perdu.
      FORCE_BODY: true,
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

/**
 * Les gabarits posent leur CSS dans <head> et leur fond sur <body>, deux choses que
 * DOMPurify jette (il ne rend que le contenu du corps) : on les remonte dans le corps.
 */
function hoistHead(dirty: string): string {
  if (typeof DOMParser === "undefined") return dirty;
  const doc = new DOMParser().parseFromString(dirty, "text/html");
  const styles = [...doc.head.querySelectorAll("style")].map((el) => el.outerHTML).join("");
  const bg = doc.body.getAttribute("bgcolor") || doc.body.style.backgroundColor;
  const body = /^[#\w(),.\s%]+$/.test(bg) ? `<div style="background-color:${bg}">${doc.body.innerHTML}</div>` : doc.body.innerHTML;
  return styles + body;
}

const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;

/** Sort les `<style>` d'un HTML sanitizé : ils vont dans le <head> de l'iframe de rendu. */
export function extractStyles(html: string): { html: string; styles: string } {
  const styles = html.match(STYLE_RE)?.join("") ?? "";
  return { html: styles ? html.replace(STYLE_RE, "") : html, styles };
}

/**
 * Mail « gabarit » (newsletter, notification transactionnelle) : mise en page en tables
 * larges ou fonds posés. Rendu pleine largeur sur fond clair plutôt que dans une bulle
 * teintée, sinon ses propres couleurs deviennent illisibles en thème sombre.
 */
export function isTemplatedHtml(html: string): boolean {
  return /<table\b[^>]*\bwidth\s*=\s*["']?(?:[4-9]\d\d|\d{4})|\bbgcolor\s*=|background(?:-color)?\s*:/i.test(html);
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
