/**
 * mail-snippets — insertion de modèles À LA FRAPPE, avec variables.
 *
 * Les modèles existaient déjà (cf. `mail-templates`), mais seulement derrière
 * un sélecteur : il fallait quitter le clavier pour insérer trois lignes. Ici,
 * taper `;merci` dans le composeur propose le modèle et l'insère — c'est le
 * geste de Superhuman (« snippets »), sans quitter la saisie.
 *
 * Les variables (`{{prenom}}`, `{{objet}}`…) sont remplacées au moment de
 * l'insertion. Une variable INCONNUE est laissée telle quelle : mieux vaut un
 * `{{truc}}` visible dans le brouillon qu'un trou silencieux dans un message
 * envoyé.
 *
 * 100 % PUR — aucun DOM, aucun stockage.
 */

import type { MailTemplate } from "./mail-templates";

/** Caractère qui ouvre une insertion de modèle dans le composeur. */
export const SNIPPET_TRIGGER = ";";

/** Requête de modèle en cours de frappe, et son emplacement dans le texte. */
export interface SnippetQuery {
  /** Texte tapé après le `;` (peut être vide juste après le déclencheur). */
  query: string;
  /** Index du `;` dans le texte. */
  start: number;
  /** Index de fin (position du curseur). */
  end: number;
}

/**
 * Détecte une insertion en cours : le curseur suit un `;` collé à un mot, en
 * début de ligne ou précédé d'une espace (sinon un point-virgule de ponctuation
 * déclencherait la complétion à chaque phrase). PUR.
 */
export function detectSnippetQuery(text: string, caret: number): SnippetQuery | null {
  if (caret < 0 || caret > text.length) return null;
  // On remonte jusqu'au `;` le plus proche, sans franchir un espace ni un saut.
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i]!;
    if (ch === SNIPPET_TRIGGER) break;
    if (/\s/.test(ch)) return null;
    i -= 1;
  }
  if (i < 0) return null;
  const before = i === 0 ? "" : text[i - 1]!;
  if (before && !/\s/.test(before)) return null; // `a;b` n'est pas un déclencheur
  const query = text.slice(i + 1, caret);
  // Un mot trop long n'est plus une recherche de modèle.
  if (query.length > 32) return null;
  return { query, start: i, end: caret };
}

/**
 * Modèles correspondant à une requête : raccourci d'abord (préfixe), puis nom.
 * Requête vide → tous les modèles (le déclencheur seul ouvre la liste). PUR.
 */
export function matchSnippets(templates: readonly MailTemplate[], query: string): MailTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...templates];
  const byShortcut = templates.filter((t) => (t.shortcut ?? "").toLowerCase().startsWith(q));
  const byName = templates.filter(
    (t) => !byShortcut.includes(t) && t.name.toLowerCase().includes(q),
  );
  return [...byShortcut, ...byName];
}

/** Contexte de substitution des variables d'un modèle. */
export interface SnippetContext {
  /** Prénom du correspondant (déduit du nom d'affichage). */
  prenom?: string;
  /** Nom d'affichage complet du correspondant. */
  nom?: string;
  /** Adresse du correspondant. */
  email?: string;
  /** Objet du fil / du message en cours. */
  objet?: string;
  /** Mon nom (signature courte). */
  moi?: string;
}

/** Prénom déduit d'un nom d'affichage (« Marie Dupont » → « Marie »). PUR. */
export function firstName(displayName: string | undefined, email?: string): string {
  const name = (displayName ?? "").trim();
  if (name) {
    // « Dupont, Marie » → « Marie » ; « Marie Dupont » → « Marie ».
    if (name.includes(",")) return (name.split(",")[1] ?? "").trim() || name;
    return name.split(/\s+/)[0] ?? name;
  }
  const local = (email ?? "").split("@")[0] ?? "";
  const head = local.split(/[._-]/)[0] ?? "";
  return head ? head.charAt(0).toUpperCase() + head.slice(1) : "";
}

/** Variables reconnues, pour l'aide affichée dans l'éditeur de modèles. */
export const SNIPPET_VARIABLES = [
  { name: "prenom", hint: "prénom du correspondant" },
  { name: "nom", hint: "nom affiché du correspondant" },
  { name: "email", hint: "adresse du correspondant" },
  { name: "objet", hint: "objet du message" },
  { name: "moi", hint: "mon nom" },
  { name: "date", hint: "date du jour" },
  { name: "heure", hint: "heure courante" },
] as const;

/**
 * Remplace les `{{variables}}` d'un modèle. Insensible à la casse et tolérante
 * aux espaces (`{{ prenom }}`). Une variable inconnue est CONSERVÉE telle
 * quelle — elle se voit dans le brouillon au lieu de disparaître. PUR (l'heure
 * est injectée).
 */
export function expandVariables(
  body: string,
  ctx: SnippetContext,
  now: Date = new Date(),
): string {
  const values: Record<string, string> = {
    prenom: ctx.prenom ?? "",
    nom: ctx.nom ?? "",
    email: ctx.email ?? "",
    objet: ctx.objet ?? "",
    moi: ctx.moi ?? "",
    date: now.toLocaleDateString(),
    heure: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
  return body.replace(/\{\{\s*([a-zA-Zéèêà_]+)\s*\}\}/g, (match, rawName: string) => {
    const key = rawName.toLowerCase();
    const value = values[key];
    // Variable connue mais vide → on retire le marqueur (pas de « Bonjour  , »
    // avec un trou béant) ; variable inconnue → on laisse voir le marqueur.
    if (value !== undefined) return value;
    return match;
  });
}

/**
 * Remplace la requête en cours par le corps du modèle. Renvoie le texte final
 * et la position du curseur (juste après l'insertion). PUR.
 */
export function insertSnippet(
  text: string,
  range: SnippetQuery,
  replacement: string,
): { value: string; caret: number } {
  const value = `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;
  return { value, caret: range.start + replacement.length };
}
