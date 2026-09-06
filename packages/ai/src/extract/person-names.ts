// ============================================================
// Détection de noms de personnes ABSENTS du coffre
// ============================================================

import type { EntityRef } from "./types.js";
import { isHeadingLine, normalizeForCompare } from "./text.js";

export interface PersonCandidate {
  /** Nom tel qu'il est écrit dans le texte — sert de `fields.name`. */
  name: string;
  source: "heuristic";
}

/** Plafond volontairement bas : une puce de plus est une puce ignorée. */
const MAX_CANDIDATES = 3;

const TOKEN = "[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*";
const PARTICLE = "(?:de|du|des|le|la|van|von|di|da|dos|del)";
const NAME_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])${TOKEN}(?:\\s+(?:${PARTICLE}\\s+)?${TOKEN}){1,2}(?![\\p{L}\\p{N}_])`,
  "gu",
);

/**
 * Mot qui précède immédiatement le nom. Sans lui, deux mots capitalisés
 * suffiraient — et « Google Drive », « Crédit Agricole » ou « Numerisk Sud »
 * entreraient au carnet d'adresses. Rater un nom coûte moins cher.
 * « chez » en est volontairement absent : il introduit une organisation bien
 * plus souvent qu'une personne.
 */
const TRIGGERS = new Set([
  "avec", "a", "pour", "rdv", "rendez-vous",
  "contacter", "contacte", "appeler", "appelle", "rappeler", "rappelle",
  "relancer", "relance", "voir", "revoir", "rencontrer", "rencontre",
  "remercier", "remercie", "prevenir", "previens", "ecrire", "ecrit",
  "envoyer", "envoie", "demander", "demande", "repondre", "reponse",
  "monsieur", "madame", "mademoiselle", "m", "mr", "mme", "dr", "me",
]);

/** Mots capitalisés qui ne sont jamais un nom de personne dans ce contexte. */
const STOP_TOKENS = new Set([
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
  "janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout",
  "septembre", "octobre", "novembre", "decembre",
  "journal", "note", "notes", "action", "actions", "personne", "personnes",
  "croisees", "todo", "todos", "reunion", "compte", "rendu", "objectif",
  "bonjour", "bonsoir", "merci", "cordialement", "monsieur", "madame",
  "maitre", "docteur", "societe", "entreprise", "projet", "dossier",
]);

function isInsideWikilink(text: string, at: number): boolean {
  const open = text.lastIndexOf("[[", at);
  if (open === -1) return false;
  return text.lastIndexOf("]]", at) < open;
}

function knownNames(known: EntityRef[]): Set<string> {
  const out = new Set<string>();
  for (const entity of known) {
    out.add(normalizeForCompare(entity.name));
    for (const alias of entity.aliases ?? []) out.add(normalizeForCompare(alias));
  }
  return out;
}

/**
 * Lignes de titre et blocs de code retirés : un titre de gabarit
 * (« ## Personnes croisées ») ne doit jamais devenir un contact, et un nom
 * cité dans du code n'en est pas un. Les lignes sont remplacées par des
 * espaces pour préserver les index.
 */
function maskNonProse(text: string): string {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s{0,3}```/.test(line)) {
        inFence = !inFence;
        return " ".repeat(line.length);
      }
      if (inFence || isHeadingLine(line)) return " ".repeat(line.length);
      return line;
    })
    .join("\n");
}

/**
 * Noms de personnes cités dans le texte et inconnus du coffre. Volontairement
 * conservateur : deux mots capitalisés au minimum, un mot déclencheur juste
 * avant, et aucun mot de la liste noire.
 */
export function findNewPersonCandidates(
  noteContent: string,
  known: EntityRef[],
): PersonCandidate[] {
  if (!noteContent?.trim()) return [];

  const prose = maskNonProse(noteContent);
  const alreadyKnown = knownNames(known);
  const seen = new Set<string>();
  const out: PersonCandidate[] = [];

  NAME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAME_RE.exec(prose)) !== null) {
    const name = m[0];
    const normalized = normalizeForCompare(name);
    if (seen.has(normalized) || alreadyKnown.has(normalized)) continue;
    if (isInsideWikilink(prose, m.index)) continue;

    const tokens = normalized.split(/[\s'’-]+/);
    if (tokens.some((t) => STOP_TOKENS.has(t))) continue;

    const before = normalizeForCompare(prose.slice(Math.max(0, m.index - 24), m.index));
    const trigger = before.split(/[\s(]+/).filter(Boolean).pop();
    if (!trigger || !TRIGGERS.has(trigger)) continue;

    seen.add(normalized);
    out.push({ name, source: "heuristic" });
    if (out.length === MAX_CANDIDATES) break;
  }

  return out;
}
