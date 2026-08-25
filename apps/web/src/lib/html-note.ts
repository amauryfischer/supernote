/**
 * Mode HTML d'une note : le corps reste du markdown, l'artefact y vit dans un
 * bloc ```html preview (le même que le bloc d'éditeur `htmlArtifact`).
 *
 * Conséquence voulue : basculer markdown ↔ HTML ne réécrit jamais le corps
 * entier — on ne touche qu'à la tranche du fence. Une note bascule dans un sens
 * puis dans l'autre sans rien perdre du texte qui entoure l'artefact.
 */

import { fenceFor, HTML_ARTIFACT_DEFAULT_HEIGHT } from "@supernote/editor";

export interface HtmlArtifactSlice {
  html: string;
  height: number;
  /** Bornes du bloc complet (fence ouvrante → fence fermante) dans le corps. */
  start: number;
  end: number;
}

const OPEN_RE = /^(`{3,})html[ \t]+([^\n]*)$/;

/** Première tranche `html preview` du corps, ou null. */
export function findHtmlArtifact(body: string): HtmlArtifactSlice | null {
  const lines = body.split("\n");
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  for (let i = 0; i < lines.length; i++) {
    const open = OPEN_RE.exec(lines[i] ?? "");
    const info = open?.[2] ?? "";
    if (!open || !/\bpreview\b/.test(info)) continue;

    const closeRe = new RegExp(`^\`{${(open[1] ?? "```").length},}\\s*$`);
    const content: string[] = [];
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j] ?? "")) {
      content.push(lines[j] ?? "");
      j++;
    }
    const lastLine = Math.min(j, lines.length - 1);
    const heightMatch = /\bh=(\d+)\b/.exec(info);
    return {
      html: content.join("\n"),
      height: heightMatch ? Number.parseInt(heightMatch[1] ?? "", 10) : HTML_ARTIFACT_DEFAULT_HEIGHT,
      start: offsets[i] ?? 0,
      end: (offsets[lastLine] ?? 0) + (lines[lastLine]?.length ?? 0),
    };
  }
  return null;
}

/** Sérialise un artefact en bloc markdown. */
export function htmlArtifactBlock(html: string, height = HTML_ARTIFACT_DEFAULT_HEIGHT): string {
  const fence = fenceFor(html);
  return `${fence}html preview h=${height}\n${html}\n${fence}`;
}

/**
 * Réécrit (ou ajoute) l'artefact du corps. Le reste du markdown est conservé
 * caractère pour caractère.
 */
export function writeHtmlArtifact(
  body: string,
  html: string,
  height = HTML_ARTIFACT_DEFAULT_HEIGHT,
): string {
  const block = htmlArtifactBlock(html, height);
  const slice = findHtmlArtifact(body);
  if (slice) return body.slice(0, slice.start) + block + body.slice(slice.end);
  return body.trim() ? `${body.replace(/\s+$/, "")}\n\n${block}` : block;
}

/**
 * Corps d'une note qu'on vient de basculer en mode HTML : si elle ne contient
 * pas encore de bloc artefact mais que son corps EST du HTML brut (note écrite
 * hors Supernote, artefact collé en mode markdown), on l'adopte tel quel plutôt
 * que de le laisser en texte.
 */
export function initialHtmlFor(body: string): string {
  const slice = findHtmlArtifact(body);
  if (slice) return slice.html;
  const trimmed = body.trim();
  if (/^<(!doctype html|html\b|body\b)/i.test(trimmed)) return trimmed;
  return "";
}
