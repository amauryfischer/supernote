// ============================================================
// Mise au propre des actions brutes (modèle ou heuristique)
// ============================================================

import type { ExtractedAction } from "./types.js";
import { findFrenchDeadline, plausibleIsoDeadline } from "./deadline-fr.js";
import { foldForIndex, headingTexts, normalizeForCompare, stripMarkdownInline } from "./text.js";

const MIN_ACTION_LENGTH = 4;

/**
 * Mots qui, juste après « et »/« puis », prouvent qu'on est encore dans le
 * complément de la MÊME action (« le devis et la facture ») et non au début
 * d'une seconde. Sans eux, le test « finit en -er/-ir/-re » couperait
 * « notre », « autre » ou « encore ».
 */
const NOT_A_VERB = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "ce", "cet", "cette", "ces",
  "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
  "notre", "nos", "votre", "vos", "leur", "leurs",
  "autre", "autres", "encore", "toujours", "peut-etre", "meme", "memes",
  "tout", "tous", "toute", "toutes", "quatre", "quelque", "quelques",
  "il", "elle", "on", "je", "tu", "nous", "vous", "ils", "elles",
  "y", "en", "ne", "pas", "plus", "que", "qui", "quoi", "dont", "ou",
  "sur", "sous", "dans", "avec", "pour", "par", "sans", "chez", "entre",
  "vers", "contre", "depuis", "pendant", "malgre", "selon", "apres", "avant",
]);

function looksLikeInfinitive(word: string): boolean {
  const folded = foldForIndex(word) ?? word.toLowerCase();
  if (NOT_A_VERB.has(folded)) return false;
  return /^[a-z][a-z'-]+(?:er|ir|re|oir)$/.test(folded);
}

/**
 * « rappeler le notaire avant vendredi et envoyer le devis demain » → deux
 * actions. On ne coupe que devant un infinitif : « et » relie bien plus
 * souvent deux compléments que deux actions.
 */
export function splitCompoundAction(text: string): string[] {
  const parts: string[] = [];
  let rest = text;

  for (let guard = 0; guard < 4; guard++) {
    const re = /\s+(?:et\s+(?:ensuite\s+|puis\s+|aussi\s+)?|puis\s+|ensuite\s+)/gi;
    let cut = -1;
    let cutEnd = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest)) !== null) {
      const after = rest.slice(m.index + m[0].length);
      const nextWord = after.split(/[\s,;]+/)[0] ?? "";
      if (!looksLikeInfinitive(nextWord)) continue;
      const left = rest.slice(0, m.index).trim();
      if (left.length < MIN_ACTION_LENGTH || after.trim().length < MIN_ACTION_LENGTH) continue;
      cut = m.index;
      cutEnd = m.index + m[0].length;
      break;
    }
    if (cut === -1) break;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cutEnd).trim();
  }

  parts.push(rest.trim());
  return parts.filter((p) => p.length >= MIN_ACTION_LENGTH);
}

/** Retire l'expression d'échéance du libellé et rend la date ISO trouvée. */
function detachDeadline(text: string, now: Date): { text: string; deadline: string | null } {
  const found = findFrenchDeadline(text, now);
  if (!found) return { text, deadline: null };
  const cleaned = `${text.slice(0, found.start)} ${text.slice(found.end)}`
    .replace(/\s+/g, " ")
    .replace(/[\s,;:-]+$/, "")
    .replace(/\s+(?:de|du|des|le|la|les|pour|avant|d['’]ici|a|à|au|aux|en|vers)$/i, "")
    .trim();
  // Une action réduite à rien par le retrait n'était qu'une date : on garde
  // le libellé d'origine plutôt que de produire une tâche sans texte.
  return cleaned.length >= MIN_ACTION_LENGTH
    ? { text: cleaned, deadline: found.iso }
    : { text, deadline: found.iso };
}

/**
 * Passe de mise au propre commune au modèle et à l'heuristique :
 * markdown retiré, titres écartés, actions composées scindées, échéance
 * française résolue en date ISO.
 */
export function refineActions(
  raw: ExtractedAction[],
  source: string,
  now: Date,
  maxActions: number,
): ExtractedAction[] {
  const headings = headingTexts(source);
  const seen = new Set<string>();
  const out: ExtractedAction[] = [];

  for (const action of raw) {
    // Un titre n'est pas une action : ni sa forme markdown brute, ni son
    // texte nu s'il reprend un titre du document (gabarit du jour compris).
    if (/^\s{0,3}#{1,6}\s/.test(action.text ?? "")) continue;
    const clean = stripMarkdownInline(action.text ?? "");
    if (clean.length < MIN_ACTION_LENGTH) continue;
    if (headings.has(normalizeForCompare(clean))) continue;

    const modelDeadline = plausibleIsoDeadline(action.deadline, now);

    const parts = splitCompoundAction(clean);
    for (const part of parts) {
      const detached = detachDeadline(part, now);
      const key = normalizeForCompare(detached.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        ...action,
        text: detached.text,
        // La date du modèle porte sur l'action ENTIÈRE : la reporter sur
        // chaque moitié d'une action scindée inventerait une échéance.
        deadline: detached.deadline ?? (parts.length === 1 ? modelDeadline : null),
      });
      if (out.length === maxActions) return out;
    }
  }

  return out;
}
