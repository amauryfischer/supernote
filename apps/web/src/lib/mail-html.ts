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
 *    (expression(), url(javascript:)…).
 */

import DOMPurify from "dompurify";

let hookRegistered = false;

/**
 * Enregistre (une seule fois) le hook qui force des attributs de lien sûrs.
 * Idempotent : on garde un flag pour ne pas empiler le hook à chaque appel.
 */
function ensureLinkHook(): void {
  if (hookRegistered) return;
  hookRegistered = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof Element && node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/**
 * Nettoie une chaîne HTML d'e-mail et renvoie du HTML sûr (string) prêt pour
 * `dangerouslySetInnerHTML`. Config stricte (cf. doc module). Pur du point de
 * vue de l'appelant (pas d'effet de bord observable hors enregistrement unique
 * du hook DOMPurify). Renvoie `""` pour une entrée vide.
 */
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
