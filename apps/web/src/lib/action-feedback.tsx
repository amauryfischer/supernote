"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleNotch, WarningCircle } from "@phosphor-icons/react";

export type FeedbackState = "idle" | "pending" | "success" | "error";

const SUCCESS_MS = 1600;
const ERROR_MS = 4000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Retour d'action porté par le bouton lui-même (chargement → succès/échec)
 * plutôt que par un toast qui masque la vue. `run` ne lève jamais : l'erreur
 * passe dans `error` (effacée après quelques secondes) et `onError`, et `run`
 * renvoie `undefined`.
 */
export function useActionFeedback() {
  const [state, setState] = useState<FeedbackState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = useCallback((next: FeedbackState, ms: number) => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState("idle");
      setError(null);
    }, ms);
  }, []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T> | T, onError?: (message: string) => void): Promise<T | undefined> => {
      clearTimeout(timer.current);
      setError(null);
      setState("pending");
      try {
        const value = await fn();
        settle("success", SUCCESS_MS);
        return value;
      } catch (err) {
        console.error(err);
        const message = messageOf(err);
        setError(message);
        settle("error", ERROR_MS);
        onError?.(message);
        return undefined;
      }
    },
    [settle],
  );

  const succeed = useCallback(() => settle("success", SUCCESS_MS), [settle]);
  const fail = useCallback(
    (err: unknown) => {
      setError(messageOf(err));
      settle("error", ERROR_MS);
    },
    [settle],
  );

  return { state, error, run, succeed, fail, isPending: state === "pending" };
}

/**
 * Icône du bouton selon l'état : l'icône normale au repos, un spinner, une
 * coche, ou un avertissement. Annonce le résultat aux lecteurs d'écran.
 */
export function FeedbackIcon({
  state,
  idle,
  size = 15,
  error,
}: {
  state: FeedbackState;
  idle: ReactNode;
  size?: number;
  error?: string | null;
}) {
  return (
    <>
      {state === "pending" ? (
        <CircleNotch size={size} className="animate-spin" aria-hidden />
      ) : state === "success" ? (
        <Check size={size} weight="bold" className="sn-pop-in text-[var(--color-success)]" aria-hidden />
      ) : state === "error" ? (
        <WarningCircle size={size} weight="bold" className="sn-pop-in text-[var(--color-danger)]" aria-hidden />
      ) : (
        idle
      )}
      <span className="sr-only" aria-live="polite">
        {state === "success" ? "Fait" : state === "error" ? (error ?? "Échec") : ""}
      </span>
    </>
  );
}
