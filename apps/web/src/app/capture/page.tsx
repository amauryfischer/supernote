"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";

/**
 * Minimal capture-rapide page — loaded by the Electron BrowserWindow.
 * - Esc closes the window (via window.close() or IPC).
 * - Cmd/Ctrl+Enter submits: creates note in Inbox, then closes.
 * - Transparent background, frameless — controlled by Electron's BrowserWindow config.
 */
export default function CapturePage() {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const utils = trpc.useUtils();
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "note" });
      void utils.entities.search.invalidate();
    },
  });

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const closeWindow = useCallback(() => {
    if (typeof window !== "undefined") {
      window.close();
    }
  }, []);

  const submit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      closeWindow();
      return;
    }
    setStatus("saving");
    try {
      const title = trimmed.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
      await createMutation.mutateAsync({
        typeId: "note",
        fields: { title },
        body: trimmed,
      });
      setStatus("done");
      setTimeout(closeWindow, 400);
    } catch {
      setStatus("error");
    }
  }, [content, closeWindow, createMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeWindow();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      }
    },
    [closeWindow, submit],
  );

  const statusLabel =
    status === "saving"
      ? "Enregistrement…"
      : status === "done"
      ? "Note enregistrée"
      : status === "error"
      ? "Erreur lors de l'enregistrement"
      : null;

  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ backgroundColor: "transparent" }}
    >
      <div
        className="flex w-full flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{
          maxWidth: 560,
          margin: "0 16px",
          backgroundColor: "var(--surface-1, rgba(30,30,30,0.95))",
          borderColor: "var(--border-subtle, rgba(255,255,255,0.08))",
          backdropFilter: "blur(20px)",
        }}
      >
        {/* Hint bar */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.06))" }}
        >
          <span className="text-[11px]" style={{ color: "var(--text-muted, #888)" }}>
            Capture rapide — Inbox
          </span>
          <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--text-muted, #888)" }}>
            <span className="hidden sm:inline">
              <kbd className="font-mono">Esc</kbd> Annuler
            </span>
            <span className="hidden sm:inline">
              <kbd className="font-mono">⌘ Enter</kbd> Enregistrer
            </span>
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Capture rapide…"
          rows={5}
          disabled={status === "saving" || status === "done"}
          className="resize-none px-4 py-3 text-sm outline-none"
          style={{
            backgroundColor: "transparent",
            color: "var(--text-primary, #f0f0f0)",
            lineHeight: 1.6,
          }}
          aria-label="Contenu de la note"
        />

        {/* Action row — touch-friendly submit button visible on small screens */}
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.06))" }}
        >
          {statusLabel ? (
            <span
              className="text-[11px]"
              style={{ color: status === "error" ? "#ef4444" : "var(--accent, #6366f1)" }}
            >
              {statusLabel}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={status === "saving" || status === "done"}
            className="rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "var(--accent, #6366f1)", color: "white" }}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
