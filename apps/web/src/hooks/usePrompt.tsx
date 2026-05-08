"use client";

/**
 * Global prompt + confirm provider.
 *
 * Mounted ONCE at the root layout level so any component can call
 * `usePrompt()` / `useConfirm()` without having to render its own modal.
 * Returns a function that yields a Promise — same ergonomics as the native
 * `window.prompt()` / `window.confirm()` it replaces, but theme-aware and
 * non-blocking (so the Chrome MCP DevTools driver stays alive).
 *
 * Usage:
 *   const prompt = usePrompt();
 *   const name = await prompt("Nom du dossier ?");
 *   if (!name) return;  // user cancelled
 *
 *   const confirm = useConfirm();
 *   if (!await confirm({ title: "Supprimer ?", destructive: true })) return;
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { PromptModal } from "@/components/shell/PromptModal";
import { ConfirmModal } from "@/components/shell/ConfirmModal";

export interface PromptOptions {
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type PromptFn = (title: string, opts?: PromptOptions) => Promise<string | null>;
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

interface DialogContextValue {
  prompt: PromptFn;
  confirm: ConfirmFn;
}

const DialogContext = createContext<DialogContextValue | null>(null);

interface PromptState {
  open: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmState {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function PromptProvider({ children }: { children: React.ReactNode }) {
  const [promptState, setPromptState] = useState<PromptState>({
    open: false,
    title: "",
  });
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    title: "",
  });

  // Resolvers stored in refs so concurrent React renders don't lose them.
  // Only one prompt / confirm can be open at a time — that's a reasonable
  // simplification for an app this size and avoids a queue.
  const promptResolverRef = useRef<((value: string | null) => void) | null>(null);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  const prompt = useCallback<PromptFn>((title, opts) => {
    return new Promise<string | null>((resolve) => {
      // If a previous prompt was somehow still open, resolve it as cancelled
      // so its caller doesn't dangle forever.
      if (promptResolverRef.current) {
        promptResolverRef.current(null);
      }
      promptResolverRef.current = resolve;
      setPromptState({
        open: true,
        title,
        placeholder: opts?.placeholder,
        defaultValue: opts?.defaultValue,
        confirmLabel: opts?.confirmLabel,
        cancelLabel: opts?.cancelLabel,
      });
    });
  }, []);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
      }
      confirmResolverRef.current = resolve;
      setConfirmState({
        open: true,
        title: opts.title,
        description: opts.description,
        confirmLabel: opts.confirmLabel,
        cancelLabel: opts.cancelLabel,
        destructive: opts.destructive,
      });
    });
  }, []);

  const handlePromptConfirm = useCallback((value: string) => {
    const resolver = promptResolverRef.current;
    promptResolverRef.current = null;
    setPromptState((s) => ({ ...s, open: false }));
    resolver?.(value);
  }, []);

  const handlePromptCancel = useCallback(() => {
    const resolver = promptResolverRef.current;
    promptResolverRef.current = null;
    setPromptState((s) => ({ ...s, open: false }));
    resolver?.(null);
  }, []);

  const handleConfirmAccept = useCallback(() => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState((s) => ({ ...s, open: false }));
    resolver?.(true);
  }, []);

  const handleConfirmCancel = useCallback(() => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState((s) => ({ ...s, open: false }));
    resolver?.(false);
  }, []);

  const value = useMemo<DialogContextValue>(
    () => ({ prompt, confirm }),
    [prompt, confirm],
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
      <PromptModal
        open={promptState.open}
        title={promptState.title}
        placeholder={promptState.placeholder}
        defaultValue={promptState.defaultValue}
        confirmLabel={promptState.confirmLabel}
        cancelLabel={promptState.cancelLabel}
        onConfirm={handlePromptConfirm}
        onCancel={handlePromptCancel}
      />
      <ConfirmModal
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        cancelLabel={confirmState.cancelLabel}
        destructive={confirmState.destructive}
        onConfirm={handleConfirmAccept}
        onCancel={handleConfirmCancel}
      />
    </DialogContext.Provider>
  );
}

function useDialogContext(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error(
      "usePrompt / useConfirm must be used inside <PromptProvider>",
    );
  }
  return ctx;
}

/** Returns an async `prompt(title, opts) => Promise<string | null>`. */
export function usePrompt(): PromptFn {
  return useDialogContext().prompt;
}

/** Returns an async `confirm({ title, ... }) => Promise<boolean>`. */
export function useConfirm(): ConfirmFn {
  return useDialogContext().confirm;
}
