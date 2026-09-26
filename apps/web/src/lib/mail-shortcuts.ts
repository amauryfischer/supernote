/**
 * mail-shortcuts — table DÉCLARATIVE des raccourcis clavier du mail.
 *
 * Une seule source de vérité pour :
 *  - le handler clavier (`useMailKeyboard`) qui résout une frappe → action ;
 *  - la feuille d'aide `?` (`MailShortcutsHelp`) qui se GÉNÈRE depuis cette
 *    table — impossible d'ajouter un raccourci sans qu'il soit documenté.
 *
 * Modèle :
 *  - `contexts` = où le raccourci s'applique (liste / groupe ouvert / fil ouvert).
 *    Un raccourci « global » liste simplement les trois.
 *  - `keys` = alternatives, chacune étant une SÉQUENCE de touches. Une séquence
 *    à deux éléments est un accord à la Gmail (`g` puis `i`). Le résolveur gère
 *    l'état intermédiaire (préfixe en attente).
 *
 * 100 % pur : aucun DOM, aucun React — testable et lisible d'un coup d'œil.
 */

/** Contexte d'application d'un raccourci. */
export type MailContext = "list" | "group" | "thread";

/** Action déclenchable au clavier. Le câblage vit dans la page (handlers). */
export type MailActionId =
  // Navigation
  | "next"
  | "prev"
  | "open"
  | "close"
  | "paneGroup"
  | "paneList"
  | "goInbox"
  | "goTodo"
  | "goStarred"
  // Triage
  | "archive"
  | "done"
  | "snooze"
  | "snoozeMenu"
  | "delete"
  | "markUnread"
  | "mute"
  | "spam"
  | "star"
  | "label"
  | "todoDo"
  | "todoSchedule"
  | "todoDelegate"
  | "todoEliminate"
  | "select"
  | "undo"
  // Rédaction
  | "reply"
  | "replyAll"
  | "forward"
  | "compose"
  | "aiDraft"
  | "send"
  // Vue
  | "search"
  | "assistant"
  | "help";

/** Familles affichées dans la feuille d'aide (ordre = ordre des sections). */
export const MAIL_SHORTCUT_GROUPS = [
  "Navigation",
  "Triage",
  "Rédaction",
  "Vue",
] as const;
export type MailShortcutGroup = (typeof MAIL_SHORTCUT_GROUPS)[number];

export interface MailBinding {
  id: MailActionId;
  /** Alternatives ; chaque alternative est une séquence de touches. */
  keys: string[][];
  /** Rendu lisible dans l'aide (« j / ↓ », « g puis i »). */
  display: string;
  label: string;
  group: MailShortcutGroup;
  contexts: MailContext[];
}

const ALL: MailContext[] = ["list", "group", "thread"];

/**
 * Table des raccourcis. Les touches lettres sont écrites en MINUSCULE : la
 * normalisation (`normalizeKey`) abaisse la casse, donc `E` déclenche `e` — et
 * un raccourci ne se perd pas parce que Verr.Maj est actif.
 */
export const MAIL_SHORTCUTS: MailBinding[] = [
  // ── Navigation ────────────────────────────────────────────────────────────
  {
    id: "next",
    keys: [["j"], ["ArrowDown"]],
    display: "j / ↓",
    label: "Email suivant",
    group: "Navigation",
    contexts: ALL,
  },
  {
    id: "prev",
    keys: [["k"], ["ArrowUp"]],
    display: "k / ↑",
    label: "Email précédent",
    group: "Navigation",
    contexts: ALL,
  },
  {
    id: "open",
    keys: [["Enter"], ["o"]],
    display: "↵ / o",
    label: "Ouvrir",
    group: "Navigation",
    contexts: ALL,
  },
  {
    id: "close",
    keys: [["Escape"], ["u"]],
    display: "Échap / u",
    label: "Revenir à la liste",
    group: "Navigation",
    contexts: ["group", "thread"],
  },
  {
    id: "paneGroup",
    keys: [["ArrowRight"]],
    display: "→",
    label: "Passer aux emails du groupe",
    group: "Navigation",
    contexts: ["group"],
  },
  {
    id: "paneList",
    keys: [["ArrowLeft"]],
    display: "←",
    label: "Revenir du groupe à la liste",
    group: "Navigation",
    contexts: ["group"],
  },
  {
    id: "goInbox",
    keys: [["g", "i"]],
    display: "g puis i",
    label: "Aller à la boîte de réception",
    group: "Navigation",
    contexts: ALL,
  },
  {
    id: "goTodo",
    keys: [["g", "t"]],
    display: "g puis t",
    label: "Aller aux tâches (Eisenhower)",
    group: "Navigation",
    contexts: ALL,
  },
  {
    id: "goStarred",
    keys: [["g", "s"]],
    display: "g puis s",
    label: "Aller aux emails suivis (étoile)",
    group: "Navigation",
    contexts: ALL,
  },

  // ── Triage ────────────────────────────────────────────────────────────────
  {
    id: "archive",
    keys: [["e"]],
    display: "e",
    label: "Archiver",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "done",
    keys: [["d"]],
    display: "d",
    label: "Marquer comme fait",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "snooze",
    keys: [["s"]],
    display: "s",
    label: "Reporter à demain",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "snoozeMenu",
    keys: [["h"]],
    display: "h",
    label: "Reporter à… (choix de l'échéance)",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "delete",
    keys: [["#"]],
    display: "#",
    label: "Supprimer (corbeille)",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "markUnread",
    keys: [["n"]],
    display: "n",
    label: "Marquer comme non lu",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "star",
    keys: [["t"]],
    display: "t",
    label: "Étoile (suivre)",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "mute",
    keys: [["m"]],
    display: "m",
    label: "Ignorer le fil (mute)",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "spam",
    keys: [["!"]],
    display: "!",
    label: "Signaler comme spam",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "label",
    keys: [["l"]],
    display: "l",
    label: "Ajouter un label",
    group: "Triage",
    contexts: ALL,
  },
  // Chiffres de la rangée du haut : sur AZERTY sans Maj, `key` vaut & é " '.
  {
    id: "todoDo",
    keys: [["1"], ["&"]],
    display: "1",
    label: "Todo : Faire",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "todoSchedule",
    keys: [["2"], ["é"]],
    display: "2",
    label: "Todo : Planifier",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "todoDelegate",
    keys: [["3"], ['"']],
    display: "3",
    label: "Todo : Déléguer",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "todoEliminate",
    keys: [["4"], ["'"]],
    display: "4",
    label: "Todo : Éliminer",
    group: "Triage",
    contexts: ALL,
  },
  {
    id: "select",
    keys: [["x"]],
    display: "x",
    label: "Cocher / décocher la ligne",
    group: "Triage",
    contexts: ["list", "group"],
  },
  {
    id: "undo",
    keys: [["z"]],
    display: "z",
    label: "Annuler la dernière action",
    group: "Triage",
    contexts: ALL,
  },

  // ── Rédaction ─────────────────────────────────────────────────────────────
  {
    id: "reply",
    keys: [["r"]],
    display: "r",
    label: "Répondre",
    group: "Rédaction",
    contexts: ALL,
  },
  {
    id: "replyAll",
    keys: [["a"]],
    display: "a",
    label: "Répondre à tous",
    group: "Rédaction",
    contexts: ALL,
  },
  {
    id: "forward",
    keys: [["f"]],
    display: "f",
    label: "Transférer",
    group: "Rédaction",
    contexts: ALL,
  },
  {
    id: "compose",
    keys: [["c"]],
    display: "c",
    label: "Nouveau message",
    group: "Rédaction",
    contexts: ALL,
  },
  {
    id: "aiDraft",
    keys: [["w"]],
    display: "w",
    label: "Brouillons IA",
    group: "Rédaction",
    contexts: ["thread"],
  },
  {
    id: "send",
    // Géré par les champs de rédaction eux-mêmes : le résolveur ignore les touches modifiées.
    keys: [],
    display: "Ctrl+↵ / ⌘+↵",
    label: "Envoyer (en rédigeant)",
    group: "Rédaction",
    contexts: ALL,
  },

  // ── Vue ───────────────────────────────────────────────────────────────────
  {
    id: "search",
    keys: [["/"]],
    display: "/",
    label: "Rechercher",
    group: "Vue",
    contexts: ALL,
  },
  {
    id: "assistant",
    keys: [["i"]],
    display: "i",
    label: "Assistant (IA)",
    group: "Vue",
    contexts: ALL,
  },
  {
    id: "help",
    keys: [["?"]],
    display: "?",
    label: "Afficher les raccourcis",
    group: "Vue",
    contexts: ALL,
  },
];

/**
 * Normalise une touche d'événement clavier vers la forme utilisée dans la table.
 * Les lettres passent en minuscule (Verr.Maj / Maj+lettre restent opérants), les
 * touches nommées (`ArrowDown`, `Escape`, `Enter`) sont conservées telles quelles.
 */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Résultat de la résolution d'une frappe. */
export type KeyResolution =
  /** Une action est déclenchée. */
  | { kind: "action"; id: MailActionId }
  /** La touche ouvre un accord (`g`) : on attend la suivante. */
  | { kind: "pending"; prefix: string }
  /** Rien ne correspond (la frappe est laissée au navigateur). */
  | { kind: "none" };

/** Bindings applicables à un contexte donné. */
export function bindingsFor(context: MailContext): MailBinding[] {
  return MAIL_SHORTCUTS.filter((b) => b.contexts.includes(context));
}

/**
 * Résout une frappe dans un contexte, en tenant compte d'un éventuel préfixe
 * d'accord déjà saisi (`g`). PUR.
 *
 * Ordre de priorité :
 *  1. si un préfixe est en attente, seule une séquence `[prefix, key]` compte
 *     (sinon l'accord est abandonné → `none`, la frappe ne « fuit » pas sur un
 *     raccourci simple homonyme) ;
 *  2. sinon, une séquence à une touche ;
 *  3. sinon, une séquence à deux touches dont la 1ʳᵉ correspond → `pending`.
 */
export function resolveKey(
  context: MailContext,
  pending: string | null,
  rawKey: string,
): KeyResolution {
  const key = normalizeKey(rawKey);
  const applicable = bindingsFor(context);

  if (pending) {
    for (const b of applicable) {
      for (const seq of b.keys) {
        if (seq.length === 2 && seq[0] === pending && seq[1] === key) {
          return { kind: "action", id: b.id };
        }
      }
    }
    return { kind: "none" };
  }

  for (const b of applicable) {
    for (const seq of b.keys) {
      if (seq.length === 1 && seq[0] === key) return { kind: "action", id: b.id };
    }
  }
  for (const b of applicable) {
    for (const seq of b.keys) {
      if (seq.length === 2 && seq[0] === key) return { kind: "pending", prefix: key };
    }
  }
  return { kind: "none" };
}

/** Raccourcis d'un groupe, pour le rendu de la feuille d'aide. */
export function shortcutsByGroup(group: MailShortcutGroup): MailBinding[] {
  return MAIL_SHORTCUTS.filter((b) => b.group === group);
}
