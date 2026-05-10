"use client";

import {
  BookOpen,
  Calendar,
  FileText,
  Hash,
  Plus,
  Stack,
  Users,
  Lightning,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useShellChrome, useMobileFab, useMobileTitle } from "@/components/shell/shell-chrome-context";
import { useCreateInboxNote } from "@/hooks/useCreateInboxNote";
import type { SupernoteEditorProps, EntityRef } from "@supernote/editor";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import { useTranslations } from "next-intl";

// Dynamic import: BlockNote uses browser-only APIs (ProseMirror, etc.)
// SSR-safe, same pattern as NoteEditor.tsx
const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorPlaceholder /> }
);

interface QuickAccessItem {
  labelKey: string;
  descriptionKey: string;
  icon: PhosphorIcon;
  href: string;
}

const QUICK_ACCESS: QuickAccessItem[] = [
  { labelKey: "nav.notes", descriptionKey: "home.descriptions.notes", icon: FileText, href: "/notes" },
  { labelKey: "nav.contacts", descriptionKey: "home.descriptions.contacts", icon: Users, href: "/contacts" },
  { labelKey: "nav.projects", descriptionKey: "home.descriptions.projects", icon: Stack, href: "/projets" },
  { labelKey: "nav.journal", descriptionKey: "home.descriptions.journal", icon: Calendar, href: "/journal" },
  { labelKey: "nav.schemas", descriptionKey: "home.descriptions.schemas", icon: Hash, href: "/schemas" },
  { labelKey: "nav.views", descriptionKey: "home.descriptions.views", icon: BookOpen, href: "/vues" },
  { labelKey: "nav.routines", descriptionKey: "home.descriptions.routines", icon: Lightning, href: "/routines" },
];

/**
 * The writing surface IS the homepage. The user can start typing immediately.
 * As soon as they start writing, the other affordances fade out so the writing
 * flow is unobstructed. ESC restores the home view.
 *
 * Uses SupernoteEditor (BlockNote) so the home editor has the same slash menu,
 * block types, and capabilities as /notes/[id].
 */
/** Derive a display name from entity fields / filePath */
function entityDisplayName(entity: { fields: Record<string, unknown>; filePath: string }): string {
  const name = entity.fields["name"] ?? entity.fields["titre"] ?? entity.fields["title"];
  if (typeof name === "string" && name.length > 0) return name;
  return entity.filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? entity.filePath;
}

export function WritingSurface() {
  const t = useTranslations();
  // markdown content as string (driven by BlockNote onChange)
  const [content, setContent] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  // editorKey lets us reset the BlockNote instance when exitWriting is called
  const [editorKey, setEditorKey] = useState(0);
  // Drives a brief border flash on the surface when the editor is reset,
  // so the user has a visual confirmation that "Nouveau" did something
  // even before BlockNote's contenteditable has mounted.
  const [justReset, setJustReset] = useState(false);
  const { setFocusMode, onRequestNewNote } = useShellChrome();
  const router = useRouter();
  const { saveNote, onContentChange, resetNote, isSaving, lastSaved, saveError } =
    useCreateInboxNote();

  // tRPC entity resolvers for slash-menu entity pickers
  const utils = trpc.useUtils();
  const resolvers = useMemo(
    () => ({
      searchEntities: async (query: string, typeId?: string): Promise<EntityRef[]> => {
        try {
          const res = await utils.entities.search.fetch({ query, typeId, limit: 8 });
          return res.items.map((e) => ({
            id: e.id,
            name: entityDisplayName(e),
            type: e.typeId,
          }));
        } catch {
          return [];
        }
      },
      createEntity: async (typeId: string, name: string): Promise<EntityRef> => {
        const e = await trpcVanillaClient.entities.create.mutate({
          typeId,
          fields: { name },
        });
        return { id: e.id, name: entityDisplayName(e), type: e.typeId };
      },
      getEntity: async (id: string): Promise<EntityRef | null> => {
        try {
          const e = await utils.entities.get.fetch({ id });
          return { id: e.id, name: entityDisplayName(e), type: e.typeId };
        } catch {
          return null;
        }
      },
    }),
    [utils]
  );

  const isWriting = isFocused || content.length > 0;

  // Previously the home surface dimmed the sidebar / TopBar / RightPanel as
  // soon as the user typed, which made the page feel transparent and
  // disconnected from the rest of the app. Keep the shell intact on the home
  // route; focus mode is still available on the standalone /notes editor.
  useEffect(() => {
    setFocusMode(false);
    return () => setFocusMode(false);
  }, [setFocusMode]);

  // Listen for "request new note" events from the topbar / shortcuts
  useEffect(() => {
    return onRequestNewNote(() => {
      // Reset content and remount the BlockNote editor for a blank slate
      setContent("");
      resetNote();
      setEditorKey((k) => k + 1);
    });
  }, [onRequestNewNote, resetNote]);

  // Auto-focus when navigated to "/?new=true" (from topbar "Nouveau" on other pages)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "true") {
      // Reset and remount editor
      setContent("");
      resetNote();
      setEditorKey((k) => k + 1);
      // Clean the param from URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState({}, "", url.toString());
    }
  }, [resetNote]);

  // After the editor remounts (editorKey changed), focus the contenteditable
  // so the user can start typing immediately. SupernoteEditor doesn't expose
  // an autoFocus prop, so we focus via DOM as a minimal cross-cutting fix.
  //
  // BlockNote is dynamically imported and ProseMirror takes more than a single
  // animation frame to mount its [contenteditable=true] node, so the previous
  // single-rAF attempt silently no-op'd. We watch the surface subtree with a
  // MutationObserver, focus as soon as the node appears, and use a 2 s timeout
  // as a safety net so we never leak the observer.
  const surfaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editorKey === 0) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    // Trigger the visual flash so the user gets feedback even if BlockNote is
    // still mounting and focus hasn't landed yet.
    setJustReset(true);
    const flashTimer = window.setTimeout(() => setJustReset(false), 220);

    let done = false;
    const tryFocus = (): boolean => {
      const el = surface.querySelector<HTMLElement>(
        ".bn-editor [contenteditable=\"true\"]",
      );
      if (!el) return false;
      el.focus();
      setIsFocused(true);
      done = true;
      return true;
    };

    // It might already be there (cached dynamic import) — try synchronously.
    if (tryFocus()) {
      return () => {
        window.clearTimeout(flashTimer);
      };
    }

    const observer = new MutationObserver(() => {
      if (tryFocus()) observer.disconnect();
    });
    observer.observe(surface, { childList: true, subtree: true });

    const safetyTimer = window.setTimeout(() => {
      if (!done) observer.disconnect();
    }, 2000);

    return () => {
      observer.disconnect();
      window.clearTimeout(safetyTimer);
      window.clearTimeout(flashTimer);
    };
  }, [editorKey]);

  // Show success toast after save
  useEffect(() => {
    if (!lastSaved) return;
    setSaveToast(t("home.noteSaved"));
    const timer = setTimeout(() => setSaveToast(null), 2000);
    return () => clearTimeout(timer);
  }, [lastSaved, t]);

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

  // Mobile chrome: title + FAB to start a new note. The FAB does the same
  // as the desktop topbar's "Nouveau" button — clears the surface and
  // refocuses the editor.
  useMobileTitle("Accueil");
  const startNewNote = useCallback(() => {
    setContent("");
    resetNote();
    setEditorKey((k) => k + 1);
  }, [resetNote]);
  useMobileFab({ icon: Plus, label: "Nouvelle note", onPress: startNewNote });

  // Derive the auto-title from the first non-empty line of markdown.
  const titlePreview =
    content.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
  // Strip leading markdown heading markers for display
  const titleClean = titlePreview.replace(/^#+\s*/, "");
  const truncatedTitle =
    titleClean.length > 60 ? titleClean.slice(0, 60) + "…" : titleClean;

  return (
    <div
      ref={surfaceRef}
      data-tour="writing-surface"
      data-just-reset={justReset ? "true" : undefined}
      className="writing-surface-root relative mx-auto flex h-full max-w-3xl flex-col px-4 md:px-8"
    >
      {/* Writing canvas */}
      <div
        className={`transition-all duration-300 ease-out ${
          isWriting ? "pt-8 md:pt-20" : "pt-6 md:pt-16"
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
            {t("home.inbox", { title: truncatedTitle || t("home.newNote") })}
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
            resolvers={resolvers}
            placeholder="Commencez à écrire ou tapez « / » pour les commandes…"
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

      {/* Footer hint when writing — keyboard shortcuts only make sense on
          desktop; on mobile the FAB and the bottom nav handle save/exit. */}
      <div
        className={`pointer-events-none fixed bottom-6 left-1/2 z-20 hidden -translate-x-1/2 transition-all duration-200 md:block ${
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
            {isSaving ? t("home.savingHint") : t("home.saveHint")}
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
            {t("home.quitHint")}
          </button>
        </div>
      </div>

      {/* Quick access grid — fades out while writing */}
      <div
        className={`mt-6 transition-all duration-300 ease-out md:mt-12 ${
          isWriting
            ? "pointer-events-none -translate-y-2 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <h2
          className="mb-3 text-[10px] font-medium uppercase tracking-widest md:mb-4"
          style={{ color: "var(--text-muted)" }}
        >
          {t("home.quickAccess")}
        </h2>
        <div className="grid grid-cols-2 gap-2 pb-24 md:gap-3 md:pb-12">
          {QUICK_ACCESS.map((item) => (
            <button
              key={item.labelKey}
              type="button"
              onClick={() => router.push(item.href)}
              className="quick-access-card group flex items-center gap-3 rounded-xl border p-4 text-left"
            >
              <div
                className="quick-access-icon flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md"
              >
                <item.icon size={16} weight="duotone" />
              </div>
              <div className="min-w-0">
                <p
                  className="text-sm font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {t(item.labelKey)}
                </p>
                <p
                  className="truncate text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t(item.descriptionKey)}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Placeholder styling for the BlockNote editor.
          Was `<style jsx global>` under Next + styled-jsx; on Vite we just
          inline a plain <style> tag — modern browsers scope rules globally
          when there's no `scoped` attribute, which matches the previous
          intent (these selectors target BlockNote DOM owned elsewhere). */}
      <style>{`
        /* Brief border flash when the editor is reset (e.g. "Nouveau" from
           another page) — gives the user instant feedback even before BlockNote's
           dynamic chunk has mounted. */
        .writing-surface-root {
          border-radius: 0.75rem;
          box-shadow: 0 0 0 0 transparent;
          transition: box-shadow 200ms ease-out;
        }
        .writing-surface-root[data-just-reset="true"] {
          animation: writing-surface-flash 220ms ease-out;
        }
        @keyframes writing-surface-flash {
          0% {
            box-shadow: 0 0 0 0 transparent;
          }
          40% {
            box-shadow: 0 0 0 2px var(--accent, #6366f1);
          }
          100% {
            box-shadow: 0 0 0 0 transparent;
          }
        }
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
        /* Placeholder via BlockNote's .bn-is-empty attribute. The selector
           also targets BlockNote's own English placeholder which it injects
           with the ProseMirror placeholder plugin — we override the visible
           string by hiding the original (.bn-inline-content[data-placeholder])
           and synthesizing our own. */
        .writing-surface-editor .bn-editor [data-placeholder]::before,
        .writing-surface-editor .bn-block-group .bn-block-outer:only-child .bn-block:only-child p.bn-is-empty::before {
          content: "Commencez à écrire ou tapez « / » pour les commandes…";
          color: var(--text-muted);
          opacity: 0.45;
          pointer-events: none;
          position: absolute;
        }

        /* Quick-access cards — clearer affordance + tactile feedback so the
           grid feels like a real menu, not a faint set of placeholders. */
        .quick-access-card {
          background-color: var(--surface-1);
          border-color: var(--border-subtle);
          color: var(--text-primary);
          transition: transform 120ms ease-out, box-shadow 160ms ease-out,
            border-color 160ms ease-out, background-color 160ms ease-out;
          cursor: pointer;
          will-change: transform;
        }
        .quick-access-card:hover {
          background-color: var(--surface-2);
          border-color: color-mix(in oklch, var(--accent) 35%, var(--border-subtle));
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.04),
            0 0 0 1px color-mix(in oklch, var(--accent) 18%, transparent);
        }
        .quick-access-card:active {
          transform: translateY(1px) scale(0.99);
          background-color: color-mix(in oklch, var(--accent) 8%, var(--surface-2));
        }
        .quick-access-card:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .quick-access-icon {
          background-color: color-mix(in oklch, var(--accent) 12%, var(--surface-2));
          color: var(--accent);
          transition: background-color 160ms ease-out;
        }
        .quick-access-card:hover .quick-access-icon {
          background-color: color-mix(in oklch, var(--accent) 22%, var(--surface-2));
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function EditorPlaceholder() {
  const t = useTranslations("home");

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
      {t("startWriting")}
    </div>
  );
}
