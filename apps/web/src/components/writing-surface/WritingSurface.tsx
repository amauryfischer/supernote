"use client";

import { Button } from "@heroui/react";
import { Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useShellChrome, useMobileFab, useMobileTitle } from "@/components/shell/shell-chrome-context";
import { useCreateInboxNote } from "@/hooks/useCreateInboxNote";
import { breadcrumb } from "@/lib/diagnostics/freeze-watchdog";
import type { SupernoteEditorProps, EntityRef } from "@supernote/editor";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import { createVaultFileAdapter } from "@/lib/vault-file-adapter";
import { useTranslations } from "next-intl";
import {
  HomeHero,
  HomeSection,
  TodayWidget,
  ContinueWidget,
  VaultStatsWidget,
  QuickActionsStrip,
  TagsCloud,
  OnThisDay,
} from "@/components/home";

// Dynamic import: BlockNote uses browser-only APIs (ProseMirror, etc.)
// SSR-safe, same pattern as NoteEditor.tsx
const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorPlaceholder /> }
);

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
  // Drives a brief wash over the sheet when the editor is reset, so the user
  // has a visual confirmation that "Nouveau" did something even before
  // BlockNote's contenteditable has mounted.
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
        '.bn-editor[contenteditable="true"]',
      );
      if (!el) return false;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
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

  // La note d'accueil n'existe pas encore quand on colle : les pièces jointes
  // vont à la racine du coffre (`_attachments/`).
  const fileAdapter = useMemo(() => createVaultFileAdapter(() => ""), []);

  const handleEditorChange = useCallback(
    (markdown: string) => {
      breadcrumb("edit:home");
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
      className="writing-surface-root relative mx-auto flex h-full max-w-5xl flex-col px-4 md:px-8"
    >
      {/* Hero greeting — hidden while writing */}
      <div
        className={`transition-all duration-300 ease-out ${
          isWriting ? "pointer-events-none -translate-y-2 opacity-0 max-h-0 overflow-hidden" : "translate-y-0 opacity-100 pt-6 md:pt-10"
        }`}
      >
        <HomeHero />
      </div>

      {/* Writing canvas */}
      <div
        className={`mx-auto w-full max-w-3xl transition-all duration-300 ease-out ${
          isWriting ? "pt-8 md:pt-20" : "pt-2"
        }`}
      >
        {/* Title chip (subtle, derived from first line) */}
        <div
          className={`transition-all duration-200 ${
            isWriting && truncatedTitle ? "opacity-100 mb-3" : "opacity-0 max-h-0 overflow-hidden mb-0"
          }`}
        >
          <span
            className="sn-eyebrow sn-eyebrow--compact inline-flex items-center gap-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--icon-decorative)" }}
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
            files={fileAdapter}
            placeholder="Commencez à écrire ou tapez « / » pour les commandes…"
            className={`w-full ${isWriting ? "min-h-[8rem]" : "min-h-[4rem]"}`}
          />
        </div>
      </div>

      {/* Toast notification for save success / error */}
      {(saveToast ?? saveError) && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-[var(--radius-md)] border px-3 py-1.5 text-[12px] shadow-md"
          style={{
            backgroundColor: "var(--surface-1)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: saveError ? "var(--danger)" : "var(--success)" }}
          />
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
          <Button
            variant="ghost"
            onPress={() => {
              if (content.trim()) saveNote(content);
            }}
            className="transition-colors hover:text-[var(--text-primary)] p-0 h-auto min-w-0"
            isDisabled={isSaving}
          >
            {isSaving ? t("home.savingHint") : t("home.saveHint")}
          </Button>
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
          <Button
            variant="ghost"
            onPress={exitWriting}
            className="transition-colors hover:text-[var(--text-primary)] p-0 h-auto min-w-0"
          >
            {t("home.quitHint")}
          </Button>
        </div>
      </div>

      {/* Dashboard — fades out while writing */}
      <div
        className={`mt-6 transition-all duration-300 ease-out ${
          isWriting
            ? "pointer-events-none -translate-y-2 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        {/* Deux temps, pas six blocs égaux. « Maintenant » : la barre d'actions
            collée à l'éditeur (24px), les deux listes actionnables à 48px, puis
            64px avant « le coffre » — une seule section, consultative. */}
        <QuickActionsStrip />

        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-x-10">
          <TodayWidget />
          <ContinueWidget />
        </div>

        <div className="mt-16 pb-24 md:pb-12">
          <HomeSection title={t("home.widgets.vault.title")}>
            <div className="flex flex-col gap-4 pt-1">
              <VaultStatsWidget />
              <TagsCloud />
              <OnThisDay />
            </div>
          </HomeSection>
        </div>
      </div>

      {/* Placeholder styling for the BlockNote editor.
          Was `<style jsx global>` under Next + styled-jsx; on Vite we just
          inline a plain <style> tag — modern browsers scope rules globally
          when there's no `scoped` attribute, which matches the previous
          intent (these selectors target BlockNote DOM owned elsewhere). */}
      <style>{`
        /* Lavage bref de la feuille quand l'éditeur est réinitialisé (« Nouveau »
           depuis une autre page) : le retour visuel arrive avant même que le
           chunk BlockNote soit monté. Anciennement un anneau violet de 2px
           autour de la page entière. */
        .writing-surface-editor {
          border-radius: var(--radius-lg);
        }
        @media (prefers-reduced-motion: no-preference) {
          .writing-surface-root[data-just-reset="true"] .writing-surface-editor {
            animation: writing-surface-flash 220ms ease-out;
          }
        }
        @keyframes writing-surface-flash {
          from {
            background-color: var(--surface-2);
          }
          to {
            background-color: transparent;
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
