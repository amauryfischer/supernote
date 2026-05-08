"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Calendar, Hash, Tag, FloppyDisk, Microphone, Image, Sparkle, X } from "@phosphor-icons/react";
import { TagSelector } from "@/components/tags/TagSelector";
import { formatRelativeDate, type Note } from "./fixtures";
import { useUpdateNote } from "./hooks";
import type { SupernoteEditorProps, EntityRef } from "@supernote/editor";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import {
  isAutoTitleEnabled,
  isDefaultTitle,
  useAutoTitle,
} from "@/hooks/useAutoTitle";
import { isAutoTagEnabled, useAutoTag } from "@/hooks/useAutoTag";
import { useTodoSync } from "@/hooks/useTodoSync";
import { AssociatedTodos } from "@/components/todos/AssociatedTodos";

// Dynamic import to avoid SSR issues — BlockNote uses browser-only APIs
const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

// ── Entity helpers ─────────────────────────────────────────────────────────────

/** Derive a human-readable display name from an entity summary */
function entityDisplayName(entity: { fields: Record<string, unknown>; filePath: string }): string {
  const name = entity.fields["name"] ?? entity.fields["titre"] ?? entity.fields["title"];
  if (typeof name === "string" && name.length > 0) return name;
  // Fall back to filename without extension
  return entity.filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? entity.filePath;
}

interface NoteEditorProps {
  note: Note;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

type DropStatus =
  | "idle"
  | "audio-over"
  | "image-over"
  | "transcribing"
  | "ocr"
  | "done"
  | "error";

const DEBOUNCE_MS = 1000;
const AUTO_TITLE_DEBOUNCE_MS = 2000;
const AUTO_TITLE_MIN_CHARS = 30;
const AUTO_TAG_DEBOUNCE_MS = 5000;
const AUTO_TAG_MIN_CHARS = 30;

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "webm", "ogg", "flac"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"]);

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isAudio(name: string): boolean {
  return AUDIO_EXTENSIONS.has(fileExt(name));
}

function isImage(name: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExt(name));
}

export function NoteEditor({ note }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [dropStatus, setDropStatus] = useState<DropStatus>("idle");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [titleAiBadge, setTitleAiBadge] = useState(false);
  const [tagsAiBadge, setTagsAiBadge] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTitleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTagTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<string>(note.body);
  const titleRef = useRef<string>(note.title);
  const tagsRef = useRef<string[]>(note.tags);
  const editorInsertRef = useRef<((md: string) => void) | null>(null);

  const { updateNote } = useUpdateNote();
  const { suggest: suggestTitle, isAvailable: ollamaAvailable } = useAutoTitle();
  const { suggest: suggestTags } = useAutoTag();
  // Smart-todos pipeline: scans the body for `- [ ]` items, asks the LLM
  // which ones are real todos, and reconciles them into `todo` entities.
  // Inert until the user opts in via Settings → IA & Ollama.
  const { scheduleSync: scheduleTodoSync, flushSync: flushTodoSync } = useTodoSync({
    id: note.id,
    title: note.title,
    fields: note.fields ?? {},
  });
  // Existing-tag vocabulary for AI auto-tagging. The Ollama suggester is
  // *constrained* to this list (no new tags invented) — see useAutoTag.ts.
  // Refetched lazily; we read the latest value via a ref inside scheduleAutoTag
  // so we don't have to re-create the callback on every tag mutation.
  const existingTagsQuery = trpc.tags.list.useQuery({});
  const existingTagPaths = useMemo<string[]>(
    () =>
      ((existingTagsQuery.data as Array<{ path: string }> | undefined) ?? [])
        .map((t) => t.path)
        .filter((p): p is string => typeof p === "string" && p.length > 0),
    [existingTagsQuery.data],
  );
  const existingTagPathsRef = useRef<string[]>([]);
  useEffect(() => {
    existingTagPathsRef.current = existingTagPaths;
  }, [existingTagPaths]);
  const utilsForTags = trpc.useUtils();
  const tagsUpdateMutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      void utilsForTags.entities.get.invalidate({ id: note.id });
      void utilsForTags.entities.list.invalidate({ typeId: "note" });
      void utilsForTags.tags.list.invalidate();
    },
  });

  // Reset state when switching to a different note. We key on `note.id` only
  // so a tRPC re-fetch of the *same* note (after auto-save) doesn't wipe the
  // AI badges or clobber the unsaved local title/body the user is mid-edit.
  useEffect(() => {
    titleRef.current = note.title;
    bodyRef.current = note.body;
    tagsRef.current = note.tags;
    setTitle(note.title);
    setTags(note.tags);
    setTitleAiBadge(false);
    setTagsAiBadge(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (autoTitleTimer.current) clearTimeout(autoTitleTimer.current);
      if (autoTagTimer.current) clearTimeout(autoTagTimer.current);
    };
  }, []);

  const transcribeAudio = trpc.system.transcribeAudio.useMutation();
  const ocrImage = trpc.system.ocrImage.useMutation();

  // tRPC utils for entity resolvers (imperatively fetched, not subscribed)
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
          // Mode degrade: return empty list instead of crashing
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

  function showToast(msg: string, durationMs = 3000) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), durationMs);
  }

  const triggerAutoSave = useCallback(
    (markdown: string, updatedTitle: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      debounceRef.current = setTimeout(async () => {
        try {
          await updateNote(note.id, updatedTitle, markdown);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 3000);
        }
      }, DEBOUNCE_MS);
    },
    [note.id, updateNote],
  );

  /**
   * Run an AI title suggestion now (regardless of the auto-toggle).
   * Updates UI + persists. No-op if Ollama is unavailable or returns nothing.
   */
  const runSuggestTitle = useCallback(async () => {
    if (!ollamaAvailable) {
      showToast("Ollama indisponible — démarrez 'OLLAMA_ORIGINS=* ollama serve'");
      return;
    }
    if (bodyRef.current.trim().length < AUTO_TITLE_MIN_CHARS) {
      showToast("Trop court — écrivez au moins quelques phrases");
      return;
    }
    setIsSuggesting(true);
    try {
      // Manual trigger ignores the "is default" check — user explicitly asked.
      const suggested = await suggestTitle(bodyRef.current, "");
      if (!suggested) {
        showToast("Aucune suggestion (modèle non installé ?)");
        return;
      }
      titleRef.current = suggested;
      setTitle(suggested);
      setTitleAiBadge(true);
      triggerAutoSave(bodyRef.current, suggested);
    } finally {
      setIsSuggesting(false);
    }
  }, [ollamaAvailable, suggestTitle, triggerAutoSave]);

  /**
   * Auto-title scheduler — fires 2s after typing stops, only if the toggle
   * is on, Ollama is reachable, body is long enough, and the title still
   * looks like a placeholder. Silent on every failure.
   */
  const scheduleAutoTitle = useCallback(
    (markdown: string) => {
      if (!ollamaAvailable) return;
      if (!isAutoTitleEnabled()) return;
      if (markdown.trim().length < AUTO_TITLE_MIN_CHARS) return;
      if (!isDefaultTitle(titleRef.current)) return;

      if (autoTitleTimer.current) clearTimeout(autoTitleTimer.current);
      autoTitleTimer.current = setTimeout(async () => {
        if (!isDefaultTitle(titleRef.current)) return;
        const suggested = await suggestTitle(markdown, titleRef.current);
        if (!suggested) return;
        if (!isDefaultTitle(titleRef.current)) return;
        titleRef.current = suggested;
        setTitle(suggested);
        setTitleAiBadge(true);
        triggerAutoSave(bodyRef.current, suggested);
      }, AUTO_TITLE_DEBOUNCE_MS);
    },
    [ollamaAvailable, suggestTitle, triggerAutoSave],
  );

  /**
   * Auto-tag scheduler — fires 5s after typing stops, only if the toggle
   * is on, Ollama is reachable, body is long enough, and the note has no
   * tags yet (we don't override user-curated tags). Silent on every failure.
   */
  const scheduleAutoTag = useCallback(
    (markdown: string) => {
      if (!ollamaAvailable) return;
      if (!isAutoTagEnabled()) return;
      if (markdown.trim().length < AUTO_TAG_MIN_CHARS) return;
      if (tagsRef.current.length > 0) return;
      // Bonus: skip auto-tagging entirely when the user has no tag vocabulary.
      // The constrained-LLM prompt has nothing to pick from, so don't bother
      // probing or warming the network. The hook also no-ops in this case.
      if (existingTagPathsRef.current.length === 0) {
        if (typeof console !== "undefined") {
          console.info("[autoTag] no tags configured, skipping");
        }
        return;
      }

      if (autoTagTimer.current) clearTimeout(autoTagTimer.current);
      autoTagTimer.current = setTimeout(async () => {
        if (tagsRef.current.length > 0) return;
        const vocab = existingTagPathsRef.current;
        if (vocab.length === 0) return; // re-check post-debounce
        const suggested = await suggestTags(
          markdown,
          vocab,
          note.folderPath,
          tagsRef.current,
        );
        if (!suggested || suggested.length === 0) return;
        if (tagsRef.current.length > 0) return; // user added tags meanwhile
        tagsRef.current = suggested;
        setTags(suggested);
        setTagsAiBadge(true);
        try {
          await tagsUpdateMutation.mutateAsync({ id: note.id, tags: suggested });
          showToast(`Tags suggérés par Ollama: ${suggested.join(", ")}`);
        } catch {
          /* fail silent — keep local UI even if persist failed */
        }
      }, AUTO_TAG_DEBOUNCE_MS);
    },
    [ollamaAvailable, suggestTags, tagsUpdateMutation, note.id, note.folderPath],
  );

  const handleEditorChange = useCallback(
    (markdown: string) => {
      bodyRef.current = markdown;
      triggerAutoSave(markdown, title);
      scheduleAutoTitle(markdown);
      scheduleAutoTag(markdown);
      // Todo extraction runs on its own debounce (1.5s) and is gated by the
      // `supernote.ai.autoTodos` flag. The hook short-circuits when off.
      scheduleTodoSync(markdown);
    },
    [triggerAutoSave, title, scheduleAutoTitle, scheduleAutoTag, scheduleTodoSync],
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      titleRef.current = next;
      setTitle(next);
      // User is editing the title — drop the AI badge.
      if (titleAiBadge) setTitleAiBadge(false);
      // Cancel any pending auto-title since the user just took control.
      if (autoTitleTimer.current) clearTimeout(autoTitleTimer.current);
      triggerAutoSave(bodyRef.current, next);
    },
    [triggerAutoSave, titleAiBadge],
  );

  const handleManualSave = useCallback(
    async (md: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      try {
        await updateNote(note.id, title, md);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        // Run todo extraction *after* the body has been persisted, otherwise
        // the cache write would race the body write and could clobber it.
        void flushTodoSync();
      } catch {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    },
    [note.id, title, updateNote, flushTodoSync],
  );

  const insertMarkdown = useCallback((md: string) => {
    if (editorInsertRef.current) {
      editorInsertRef.current(md);
    } else {
      // Fallback: append to body
      const updated = bodyRef.current + "\n\n" + md;
      bodyRef.current = updated;
      triggerAutoSave(updated, title);
    }
  }, [triggerAutoSave, title]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.items);
    const hasAudio = files.some((f) => f.kind === "file" && isAudio(f.type || "x.mp3"));
    const hasImage = files.some((f) => f.kind === "file" && f.type.startsWith("image/"));
    if (hasAudio) setDropStatus("audio-over");
    else if (hasImage) setDropStatus("image-over");
    else setDropStatus("idle");
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropStatus("idle");
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropStatus("idle");

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      for (const file of files) {
        const name = file.name;
        if (isAudio(name)) {
          // Write temp file path via Electron's file object
          const filePath = (file as File & { path?: string }).path;
          if (!filePath) {
            showToast("Chemin introuvable — lancez depuis Electron");
            continue;
          }
          setDropStatus("transcribing");
          showToast("Transcription en cours...", 60000);
          try {
            const result = await transcribeAudio.mutateAsync({ filePath, language: "fr" });
            const md = buildAudioMarkdown(result.assetPath, result.text, result.segments);
            insertMarkdown(md);
            setDropStatus("done");
            showToast("Transcription terminee");
          } catch (err) {
            setDropStatus("error");
            showToast(`Erreur transcription: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else if (isImage(name)) {
          const filePath = (file as File & { path?: string }).path;
          if (!filePath) {
            showToast("Chemin introuvable — lancez depuis Electron");
            continue;
          }
          setDropStatus("ocr");
          showToast("OCR en cours...", 60000);
          try {
            const result = await ocrImage.mutateAsync({ filePath });
            const md = buildImageMarkdown(result.assetPath, result.text);
            insertMarkdown(md);
            setDropStatus("done");
            showToast("OCR termine");
          } catch (err) {
            setDropStatus("error");
            showToast(`Erreur OCR: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    },
    [insertMarkdown, ocrImage, transcribeAudio],
  );

  const date = new Date(note.updatedAt).toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const isDropping = dropStatus === "audio-over" || dropStatus === "image-over";

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {isDropping && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2"
          style={{ backgroundColor: "rgba(124,58,237,0.08)", border: "2px dashed var(--accent)" }}
        >
          {dropStatus === "audio-over" ? (
            <Microphone size={32} style={{ color: "var(--accent)" }} />
          ) : (
            <Image size={32} style={{ color: "var(--accent)" }} />
          )}
          <p className="text-sm font-medium" style={{ color: "var(--accent)" }}>
            {dropStatus === "audio-over" ? "Deposez pour transcrire" : "Deposez pour OCR"}
          </p>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div
          className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="px-10 py-6" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            className="w-full bg-transparent text-2xl font-bold leading-tight outline-none"
            style={{ color: "var(--text-primary)" }}
            placeholder="Sans titre"
            aria-label="Titre de la note"
          />
          {titleAiBadge && (
            <span
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
              title="Titre suggéré par l'IA"
            >
              <Sparkle size={10} weight="fill" /> IA
            </span>
          )}
          {ollamaAvailable && (
            <button
              type="button"
              onClick={runSuggestTitle}
              disabled={isSuggesting}
              className="flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs transition-all hover:opacity-80 disabled:opacity-50"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
                backgroundColor: "var(--surface-1)",
              }}
              title="Générer un titre via Ollama"
              aria-label="Suggérer un titre"
            >
              <Sparkle size={12} />
              {isSuggesting ? "..." : "Suggérer un titre"}
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Calendar size={13} style={{ color: "var(--text-muted)" }} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {date}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Hash size={13} style={{ color: "var(--text-muted)" }} />
            <span className="text-xs capitalize" style={{ color: "var(--text-muted)" }}>
              {note.folderPath}
            </span>
          </div>
          <NoteTagsInput
            noteId={note.id}
            tags={tags}
            onTagsChange={(next) => {
              tagsRef.current = next;
              setTags(next);
              if (tagsAiBadge) setTagsAiBadge(false);
              if (autoTagTimer.current) clearTimeout(autoTagTimer.current);
            }}
            aiBadge={tagsAiBadge}
          />
          <DropHint status={dropStatus} />
          <SaveIndicator status={saveStatus} />
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-10 py-6">
          <SupernoteEditor
            initialMarkdown={note.body}
            onChange={handleEditorChange}
            onSave={handleManualSave}
            resolvers={resolvers}
            className="min-h-[60vh] w-full"
          />
        </div>
        {/* Read-only summary of todos extracted from this note. Hidden when the
            note has no associated todo entities (no extra fetch cost — the
            list is cached/shared with the /todos page). */}
        <AssociatedTodos noteId={note.id} />
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-10 py-3"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Modifie {formatRelativeDate(note.updatedAt).toLowerCase()}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Glissez un fichier audio ou image pour transcrire / OCR
        </span>
      </div>
    </div>
  );
}

// ── Markdown builders ─────────────────────────────────────────────────────────

interface Segment {
  start: number;
  end: number;
  text: string;
}

function buildAudioMarkdown(assetPath: string, text: string, segments: Segment[]): string {
  const relPath = assetPath.replace(/.*_assets\//, "_assets/");
  const lines = [
    `> **Audio transcrit** — [ecouter](${relPath})`,
    "",
    text.trim(),
  ];
  if (segments.length > 0) {
    lines.push("", "<details><summary>Segments</summary>", "");
    for (const seg of segments) {
      const t = `${fmtSeconds(seg.start)} → ${fmtSeconds(seg.end)}`;
      lines.push(`- **${t}**: ${seg.text.trim()}`);
    }
    lines.push("", "</details>");
  }
  return lines.join("\n");
}

function buildImageMarkdown(assetPath: string, ocrText: string): string {
  const relPath = assetPath.replace(/.*_assets\//, "_assets/");
  return [
    `![Image](${relPath})`,
    "",
    ocrText.trim() ? `*OCR:* ${ocrText.trim()}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface SaveIndicatorProps {
  status: SaveStatus;
}

function SaveIndicator({ status }: SaveIndicatorProps) {
  if (status === "idle") return null;
  const label =
    status === "saving" ? "Sauvegarde..." : status === "saved" ? "Sauvegarde" : "Erreur";
  const color = status === "error" ? "var(--color-red-500, #ef4444)" : "var(--text-muted)";
  return (
    <div className="flex items-center gap-1" style={{ color }}>
      <FloppyDisk size={11} />
      <span className="text-[10px]">{label}</span>
    </div>
  );
}

function DropHint({ status }: { status: DropStatus }) {
  if (status === "transcribing") {
    return (
      <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--accent)" }}>
        <Microphone size={11} /> Transcription...
      </span>
    );
  }
  if (status === "ocr") {
    return (
      <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--accent)" }}>
        <Image size={11} /> OCR...
      </span>
    );
  }
  return null;
}

function EditorSkeleton() {
  return (
    <div className="animate-pulse space-y-3 pt-2">
      {[100, 80, 90, 60].map((w, i) => (
        <div
          key={i}
          className="h-4 rounded"
          style={{ width: `${w}%`, backgroundColor: "var(--surface-2)" }}
        />
      ))}
    </div>
  );
}

// ── Tag chip input ────────────────────────────────────────────────────────────
//
// Inline editable tag list for the note header. Existing tags render as
// removable chips; a "+" trigger opens the shared <TagSelector> popover so
// the user picks from the canonical hierarchical tree (rather than typing).
// Each mutation persists via `entities.update({tags})` and invalidates both
// the note-detail query and the notes list so the metadata refreshes.

interface NoteTagsInputProps {
  noteId: string;
  tags: string[];
  onTagsChange: (next: string[]) => void;
  aiBadge?: boolean;
}

function NoteTagsInput({ noteId, tags, onTagsChange, aiBadge }: NoteTagsInputProps) {
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      void utils.entities.get.invalidate({ id: noteId });
      void utils.entities.list.invalidate({ typeId: "note" });
      void utils.tags.list.invalidate();
    },
  });

  const handleChange = useCallback(
    async (next: string[]) => {
      onTagsChange(next);
      await updateMutation.mutateAsync({ id: noteId, tags: next });
    },
    [noteId, updateMutation, onTagsChange],
  );

  const removeTag = useCallback(
    (t: string) => {
      void handleChange(tags.filter((x) => x !== t));
    },
    [tags, handleChange],
  );

  return (
    <div className="flex items-center gap-1.5">
      <Tag size={13} style={{ color: "var(--text-muted)" }} />
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
          >
            #{tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`Retirer le tag ${tag}`}
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              <X size={9} weight="bold" />
            </button>
          </span>
        ))}
        {aiBadge && tags.length > 0 && (
          <span
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
            title="Tags suggérés par l'IA"
          >
            <Sparkle size={10} weight="fill" /> IA
          </span>
        )}
        <TagSelector value={tags} onChange={(next) => void handleChange(next)} />
      </div>
    </div>
  );
}
