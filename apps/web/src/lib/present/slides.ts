/**
 * slides — découpe une note markdown en diapositives pour le mode présentation.
 *
 * Règles de coupe :
 *  - un titre H1 (`# `) démarre une nouvelle diapo ;
 *  - un séparateur (`---`, `***`, `___` seuls sur leur ligne) démarre aussi
 *    une nouvelle diapo (sans rendre le trait) ;
 *  - les commentaires HTML `<!-- ... -->` deviennent les notes du présentateur
 *    de la diapo courante (retirés du contenu visible).
 *
 * Pur (pas de DOM) → testable isolément.
 */

export interface Slide {
  /** Markdown visible de la diapo (sans les notes présentateur). */
  content: string;
  /** Notes du présentateur concaténées (texte brut). */
  notes: string;
}

const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const H1_RE = /^#\s+\S/;

export function splitSlides(markdown: string): Slide[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const slides: Slide[] = [];
  let buf: string[] = [];
  let notes: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const content = buf.join("\n").trim();
    const note = notes.join("\n").trim();
    if (content || note) slides.push({ content, notes: note });
    buf = [];
    notes = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Bascule de bloc de code : on ne coupe jamais à l'intérieur.
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      buf.push(line);
      continue;
    }
    if (inFence) {
      buf.push(line);
      continue;
    }

    // Notes présentateur sur une seule ligne `<!-- ... -->`.
    const oneLineComment = /^\s*<!--([\s\S]*?)-->\s*$/.exec(line);
    if (oneLineComment) {
      notes.push((oneLineComment[1] ?? "").trim());
      continue;
    }

    // Séparateur explicite → nouvelle diapo, trait non rendu.
    if (HR_RE.test(line)) {
      flush();
      continue;
    }

    // Nouveau H1 → nouvelle diapo (sauf si la diapo courante est vide).
    if (H1_RE.test(line)) {
      if (buf.some((l) => l.trim() !== "") || notes.length > 0) flush();
      buf.push(line);
      continue;
    }

    buf.push(line);
  }
  flush();

  // Au moins une diapo, même pour une note vide.
  if (slides.length === 0) slides.push({ content: "", notes: "" });
  return slides;
}
