"use client";

import {
  BookOpen,
  Calendar,
  FileText,
  Hash,
  Stack,
  Users,
  Lightning,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useShellChrome } from "@/components/shell/shell-chrome-context";
import { useCreateInboxNote } from "@/hooks/useCreateInboxNote";
import type { SupernoteEditorProps } from "@supernote/editor";

// Dynamic import: BlockNote uses browser-only APIs (ProseMirror, etc.)
// SSR-safe, same pattern as NoteEditor.tsx
const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorPlaceholder /> }
);

interface QuickAccessItem {
  label: string;
  description: string;
  icon: PhosphorIcon;
  href: string;
}

const QUICK_ACCESS: QuickAccessItem[] = [
  { label: "Notes", description: "Vos notes libres et documents", icon: FileText, href: "/notes" },
  { label: "Contacts", description: "Personnes et organisations", icon: Users, href: "/contacts" },
  { label: "Projets", description: "Projets et tâches actives", icon: Stack, href: "/projets" },
  { label: "Journal", description: "Notes quotidiennes", icon: Calendar, href: "/journal" },
  { label: "Schémas", description: "Types d'entités et champs", icon: Hash, href: "/schemas" },
  { label: "Vues", description: "Requêtes et vues sauvegardées", icon: BookOpen, href: "/vues" },
  { label: "Routines", description: "Automations et rappels", icon: Lightning, href: "/routines" },
];

/**
 * The writing surface IS the homepage. The user can start typing immediately.
 * As soon as they start writing, the other affordances fade out so the writing
 * flow is unobstructed. ESC restores the home view.
 *
 * Uses SupernoteEditor (BlockNote) so the home editor has the same slash menu,
 * block types, and capabilities as /notes/[id].
 */
export function WritingSurface() {
  // markdown content as string (driven by BlockNote onChange)
  const [content, setContent] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  // editorKey lets us reset the BlockNote instance when exitWriting is called
  const [editorKey, setEditorKey] = useState(0);
  const shellChrome = useShellChrome();
  const router = useRouter();
  const { saveNote, onContentChange, resetNote, isSaving, lastSaved, saveError } =
    useCreateInboxNote();

  const isWriting = isFocused || content.length > 0;

  // Tell the shell to dim its non-essential UI while the user writes.
  useEffect(() => {
    shellChrome.setFocusMode(isWriting);
  }, [isWriting, shellChrome]);

  // Listen for "request new note" events from the topbar / shortcuts
  useEffect(() => {
    return shellChrome.onRequestNewNote(() => {
      // Trigger focus on the BlockNote editor via autoFocus — remount if needed
      setEditorKey((k) => k + 1);
    });
  }, [shellChrome]);

  // Auto-focus when navigated to "/?new=true" (from topbar "Nouveau" on other pages)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "true") {
      // Remount editor with autoFocus
      setEditorKey((k) => k + 1);
      // Clean the param from URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // Show success toast after save
  useEffect(() => {
    if (!lastSaved) return;
    setSaveToast("Note enregistrée");
    const t = setTimeout(() => setSaveToast(null), 2000);
    return () => clearTimeout(t);
  }, [lastSaved]);

  const handleEditorChange = useCallback(
    (markdown: string) => {
      setContent(markdown);
      onContentChange(markdown);
    },
    [onContentChange]
  );

  const handleEditorSave = useCallback(
    (markdown: string) => {
      if (markdown.trim()) saveNote(markdown);
    },
    [saveNote]
  );

  const exitWriting = useCallback(() => {
    setContent("");
    setIsFocused(false);
    resetNote();
    // Remount the editor to get a blank slate
    setEditorKey((k) => k + 1);
  }, [resetNote]);

  // Derive the auto-title from the first non-empty line of markdown.
  const titlePreview =
    content.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
  // Strip leading markdown heading markers for display
  const titleClean = titlePreview.replace(/^#+\s*/, "");
  const truncatedTitle =
    titleClean.length > 60 ? titleClean.slice(0, 60) + "…" : titleClean;

  return (
    <div className="relative mx-auto flex h-full max-w-3xl flex-col px-8">
      {/* Writing canvas */}
      <div
        className={`transition-all duration-300 ease-out ${
          isWriting ? "pt-20" : "pt-16"
        }`}
      >
        {/* Title chip (subtle, derived from first line) */}
        <div
          className={`mb-3 transition-opacity duration-200 ${
            isWriting && truncatedTitle ? "opacity-100" : "opacity-0"
          }`}
          style={{ minHeight: "1.25rem" }}
        >
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--accent)" }}
            />
            Inbox · {truncatedTitle || "nouvelle note"}
          </span>
        </div>

        {/* The actual writing area — BlockNote replaces the bare contentEditable div */}
        <div
          className="writing-surface-editor"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        >
          <SupernoteEditor
            key={editorKey}
            onChange={handleEditorChange}
            onSave={handleEditorSave}
            className="min-h-[8rem] w-full"
          />
        </div>
      </div>

      {/* Toast notification for save success / error */}
      {(saveToast ?? saveError) && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-1.5 text-[11px] text-white shadow-md"
          style={{
            backgroundColor: saveError ? "#ef4444" : "var(--accent, #6366f1)",
          }}
        >
          {saveError ?? saveToast}
        </div>
      )}

      {/* Footer hint when writing */}
      <div
        className={`pointer-events-none fixed bottom-6 left-1/2 z-20 -translate-x-1/2 transition-all duration-200 ${
          isWriting
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0"
        }`}
      >
        <div
          className="pointer-events-auto flex items-center gap-3 rounded-full border px-4 py-1.5 text-[11px] shadow-sm backdrop-blur"
          style={{
            backgroundColor: "var(--surface-1)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-muted)",
          }}
        >
          <kbd
            className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-2)",
            }}
          >
            ⌘ S
          </kbd>
          <button
            onClick={() => {
              if (content.trim()) saveNote(content);
            }}
            className="transition-colors hover:text-[var(--text-primary)]"
            disabled={isSaving}
          >
            {isSaving ? "enregistrement…" : "enregistrer"}
          </button>
          <span style={{ color: "var(--border)" }}>·</span>
          <kbd
            className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-2)",
            }}
          >
            Esc
          </kbd>
          <button
            onClick={exitWriting}
            className="transition-colors hover:text-[var(--text-primary)]"
          >
            quitter
          </button>
        </div>
      </div>

      {/* Quick access grid — fades out while writing */}
      <div
        className={`mt-12 transition-all duration-300 ease-out ${
          isWriting
            ? "pointer-events-none -translate-y-2 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <h2
          className="mb-4 text-[10px] font-medium uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Accès rapide
        </h2>
        <div className="grid grid-cols-2 gap-3 pb-12">
          {QUICK_ACCESS.map((item) => (
            <button
              key={item.label}
              onClick={() => router.push(item.href)}
              className="group flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-[var(--surface-2)]"
              style={{
                backgroundColor: "var(--surface-1)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: "var(--surface-2)" }}
              >
                <item.icon
                  size={15}
                  className="text-[var(--text-secondary)]"
                />
              </div>
              <div className="min-w-0">
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  {item.label}
                </p>
                <p
                  className="truncate text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {item.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Placeholder styling for the BlockNote editor */}
      <style jsx global>{`
        .writing-surface-editor .sn-editor-wrapper {
          background: transparent;
        }
        .writing-surface-editor .bn-editor {
          font-size: 1.0625rem;
          line-height: 1.7;
          color: var(--text-primary);
        }
        /* Hide BlockNote's own border/shadow on the writing surface */
        .writing-surface-editor .bn-root {
          border: none !important;
          box-shadow: none !important;
        }
        /* Placeholder via BlockNote's .bn-is-empty attribute */
        .writing-surface-editor .bn-block-group .bn-block-outer:only-child .bn-block:only-child p.bn-is-empty::before {
          content: "Commencez à écrire…";
          color: var(--text-muted);
          opacity: 0.5;
          pointer-events: none;
          position: absolute;
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function EditorPlaceholder() {
  return (
    <div
      style={{
        minHeight: "8rem",
        fontSize: "1.0625rem",
        lineHeight: "1.7",
        color: "var(--text-muted)",
        opacity: 0.5,
      }}
    >
      Commencez à écrire…
    </div>
  );
}
