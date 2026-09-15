/**
 * mail-markdown — mise en forme légère du composeur → HTML d'email.
 *
 * Choix assumé : pas d'éditeur WYSIWYG dans le composeur. On garde une zone de
 * TEXTE (rapide, collable, sans surprise) et une barre d'outils qui insère des
 * marqueurs Markdown. À l'envoi, le message part en `multipart/alternative` :
 * le texte brut tel qu'il a été tapé + sa conversion HTML. Un destinataire qui
 * lit en texte voit donc quelque chose de lisible, pas des balises.
 *
 * Sous-ensemble volontairement minuscule (gras, italique, code, liens, listes,
 * citations, titres, images `cid:`) : tout ce qui n'est pas reconnu reste du
 * texte, échappé. PUR — aucune dépendance, aucun DOM.
 */

/** Échappe les caractères dangereux pour l'insertion dans du HTML. PUR. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * URL autorisée dans un lien / une image générés. On n'accepte que http(s),
 * mailto et cid (images inline du message lui-même) : `javascript:` et `data:`
 * sont écartés — le corps part chez quelqu'un d'autre, on ne lui fabrique pas
 * un vecteur. PUR.
 */
function safeUrl(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:|cid:)/i.test(u) ? u : null;
}

/** Jeton de mise en réserve des blocs `code` pendant le passage inline. */
const CODE_TOKEN = "@@sn-code-";

/** Applique les marques INLINE (code, gras, italique, liens, images). PUR. */
function inlineMarkup(escaped: string): string {
  let out = escaped;
  // Code d'abord : son contenu ne doit pas recevoir les autres marques.
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code);
    return `${CODE_TOKEN}${codes.length - 1}@@`;
  });
  // Images : ![alt](url) — avant les liens (syntaxe préfixée).
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m: string, alt: string, url: string) => {
    const safe = safeUrl(url);
    return safe ? `<img src="${safe}" alt="${alt}" style="max-width:100%" />` : m;
  });
  // Liens : [texte](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m: string, label: string, url: string) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}">${label}</a>` : m;
  });
  // URLs nues.
  out = out.replace(
    /(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g,
    (_m: string, pre: string, url: string) => `${pre}<a href="${url}">${url}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])_([^_]+)_/g, "$1<em>$2</em>");
  return out.replace(
    new RegExp(`${CODE_TOKEN}(\\d+)@@`, "g"),
    (_m: string, i: string) => `<code>${codes[Number(i)] ?? ""}</code>`,
  );
}

/**
 * Convertit le corps du composeur en HTML d'email. Traite le texte ligne à
 * ligne : listes `- ` / `1. `, citations `> `, titres `#`, paragraphes séparés
 * par une ligne vide. Le reste est échappé puis passé aux marques inline. PUR.
 */
export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inQuote = false;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inlineMarkup(escapeHtml(para.join("\n"))).replace(/\n/g, "<br />")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push("</blockquote>");
      inQuote = false;
    }
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flushPara();
      closeList();
      closeQuote();
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      closeList();
      if (!inQuote) {
        out.push(
          '<blockquote style="margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #ccc;color:#555">',
        );
        inQuote = true;
      }
      out.push(`<p>${inlineMarkup(escapeHtml(quote[1] ?? ""))}</p>`);
      continue;
    }
    closeQuote();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const level = (heading[1] ?? "#").length;
      out.push(`<h${level}>${inlineMarkup(escapeHtml(heading[2] ?? ""))}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const want: "ul" | "ol" = bullet ? "ul" : "ol";
      if (listType !== want) {
        closeList();
        out.push(`<${want}>`);
        listType = want;
      }
      const content = (bullet ? bullet[1] : numbered?.[1]) ?? "";
      out.push(`<li>${inlineMarkup(escapeHtml(content))}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  closeQuote();

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${out.join("")}</div>`;
}

/**
 * Le corps contient-il une mise en forme qui JUSTIFIE d'envoyer une part HTML ?
 * Sans marque, on reste en texte pur (message plus léger, aucune surprise de
 * rendu chez le destinataire). PUR.
 */
export function hasMarkup(source: string): boolean {
  return (
    /\*\*[^*]+\*\*/.test(source) ||
    /(^|\s)_[^_]+_/.test(source) ||
    /`[^`]+`/.test(source) ||
    /\[[^\]]+\]\([^)\s]+\)/.test(source) ||
    /!\[[^\]]*\]\([^)\s]+\)/.test(source) ||
    /^\s*[-*]\s+/m.test(source) ||
    /^\s*\d+[.)]\s+/m.test(source) ||
    /^\s*>\s?/m.test(source) ||
    /^#{1,3}\s+/m.test(source)
  );
}

// ── Insertion de marques dans un <textarea> ────────────────────────────────

export type MarkupKind = "bold" | "italic" | "code" | "link" | "bullet" | "quote";

/**
 * Calcule le texte résultant de l'application d'une marque sur une sélection,
 * et la nouvelle position du curseur. PUR — l'appelant applique le résultat au
 * textarea (valeur + `setSelectionRange`).
 */
export function applyMarkup(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: MarkupKind,
): { value: string; selectionStart: number; selectionEnd: number } {
  const before = value.slice(0, selectionStart);
  const selected = value.slice(selectionStart, selectionEnd);
  const after = value.slice(selectionEnd);

  const wrap = (marker: string, placeholder: string) => {
    const inner = selected || placeholder;
    const next = `${before}${marker}${inner}${marker}${after}`;
    return {
      value: next,
      selectionStart: before.length + marker.length,
      selectionEnd: before.length + marker.length + inner.length,
    };
  };

  switch (kind) {
    case "bold":
      return wrap("**", "gras");
    case "italic":
      return wrap("_", "italique");
    case "code":
      return wrap("`", "code");
    case "link": {
      const label = selected || "texte";
      const next = `${before}[${label}](url)${after}`;
      const urlStart = before.length + label.length + 3;
      return { value: next, selectionStart: urlStart, selectionEnd: urlStart + 3 };
    }
    case "bullet":
    case "quote": {
      const prefix = kind === "bullet" ? "- " : "> ";
      // On préfixe chaque ligne de la sélection (ou la ligne courante).
      const lineStart = before.lastIndexOf("\n") + 1;
      const head = value.slice(0, lineStart);
      const block = value.slice(lineStart, selectionEnd) || prefix;
      const prefixed = block
        .split("\n")
        .map((l) => (l.startsWith(prefix) ? l : `${prefix}${l}`))
        .join("\n");
      const next = `${head}${prefixed}${after}`;
      return {
        value: next,
        selectionStart: head.length,
        selectionEnd: head.length + prefixed.length,
      };
    }
  }
}
