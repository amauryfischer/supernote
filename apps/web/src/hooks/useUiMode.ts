"use client";

import { useCallback, useSyncExternalStore } from "react";

export type UiMode = "next" | "legacy";

const STORAGE_KEY = "supernote-ui";

const listeners = new Set<() => void>();

/**
 * Registre visuel actif. Le mode est pré-peint sur `<html data-ui>` par le
 * script d'`index.html` (avant React) parce qu'il change toute la palette de
 * surfaces ; l'attribut reste la source de vérité, ce module ne fait que le
 * lire et notifier les abonnés.
 *
 * Store partagé plutôt qu'un `useState` par appelant : la bascule doit
 * re-rendre EN MÊME TEMPS le switcher, la topbar et la sidebar, qui décident
 * chacune d'une structure différente selon le registre.
 */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): UiMode {
  return document.documentElement.getAttribute("data-ui") === "legacy"
    ? "legacy"
    : "next";
}

function getServerSnapshot(): UiMode {
  return "next";
}

export function setUiMode(next: UiMode): void {
  document.documentElement.setAttribute("data-ui", next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* stockage indisponible : la bascule reste valable pour la session */
  }
  for (const listener of listeners) listener();
}

export function useUiMode(): { mode: UiMode; setMode: (m: UiMode) => void } {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setMode = useCallback((next: UiMode) => setUiMode(next), []);
  return { mode, setMode };
}
