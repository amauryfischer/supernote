"use client";

/**
 * useMailKeyboard — installe le handler clavier du mail à partir de la table
 * déclarative `mail-shortcuts`.
 *
 * Le hook ne sait RIEN du métier : il résout une frappe en `MailActionId` pour
 * le contexte courant et appelle le handler fourni. Toute la logique de triage /
 * navigation reste dans la page. Conséquence : ajouter un raccourci = ajouter
 * une ligne dans la table + un handler, et la feuille d'aide `?` se met à jour
 * toute seule.
 *
 * Garde-fous :
 *  - jamais de vol de frappe quand le focus est dans un champ de saisie ou un
 *    contenteditable (composeur, recherche, éditeur de note) ;
 *  - jamais avec Ctrl / Cmd / Alt (raccourcis navigateur et OS préservés) ;
 *  - accords à la Gmail (`g` puis `i`) via un préfixe en attente, expiré après
 *    `CHORD_TIMEOUT_MS` pour qu'un `g` oublié ne bloque pas la frappe suivante.
 */

import { useEffect, useRef, useState } from "react";
import {
  resolveKey,
  type MailActionId,
  type MailContext,
} from "@/lib/mail-shortcuts";

/** Fenêtre de saisie du 2ᵉ caractère d'un accord (`g` puis `i`). */
const CHORD_TIMEOUT_MS = 1500;

export interface UseMailKeyboardOptions {
  /** Écoute active (désactivée sur mobile, ou modale ouverte). */
  enabled: boolean;
  /** Contexte courant — décide quelles touches s'appliquent. */
  context: MailContext;
  /** Câblage action → effet. Une action sans handler est simplement ignorée. */
  handlers: Partial<Record<MailActionId, () => void>>;
}

/** True quand la cible de l'événement est une zone de saisie (on ne vole rien). */
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  // Une modale ouverte par un composant enfant (barre de report…) ne passe pas par l'état de la page.
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.closest?.('[role="dialog"]');
}

/**
 * Renvoie le préfixe d'accord en attente (`"g"` ou null) — utile pour afficher
 * un indicateur discret « g… » dans l'UI.
 */
export function useMailKeyboard({
  enabled,
  context,
  handlers,
}: UseMailKeyboardOptions): string | null {
  const [pending, setPending] = useState<string | null>(null);
  // Les handlers changent à chaque rendu (closures) : on les lit via une ref
  // pour ne pas réinstaller le listener 60 fois par seconde.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const contextRef = useRef(context);
  contextRef.current = context;
  const pendingRef = useRef<string | null>(null);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      pendingRef.current = null;
      setPending(null);
      return undefined;
    }

    const clearChord = () => {
      if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
      chordTimerRef.current = null;
      pendingRef.current = null;
      setPending(null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;

      const res = resolveKey(contextRef.current, pendingRef.current, e.key);
      if (res.kind === "none") {
        // Une frappe non reconnue purge un accord en attente (`g` puis touche
        // inconnue) sans consommer l'événement.
        if (pendingRef.current) clearChord();
        return;
      }
      if (res.kind === "pending") {
        e.preventDefault();
        pendingRef.current = res.prefix;
        setPending(res.prefix);
        if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
        chordTimerRef.current = setTimeout(clearChord, CHORD_TIMEOUT_MS);
        return;
      }
      const run = handlersRef.current[res.id];
      clearChord();
      if (!run) return;
      e.preventDefault();
      run();
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
    };
  }, [enabled]);

  return pending;
}
