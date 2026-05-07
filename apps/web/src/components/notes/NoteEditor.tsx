"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Calendar, Hash, Tag, FloppyDisk, Microphone, Image } from "@phosphor-icons/react";
import { formatRelativeDate, type Note } from "./fixtures";
import { useUpdateNote } from "./hooks";
import type { SupernoteEditorProps } from "@supernote/editor";
import { trpc } from "@/lib/trpc/client";

// Dynamic import to avoid SSR issues — BlockNote uses browser-only APIs
const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [dropStatus, setDropStatus] = useState<DropStatus>("idle");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<string>(note.body);
  const editorInsertRef = useRef<((md: string) => void) | null>(null);

  const { updateNote } = useUpdateNote();

  const transcribeAudio = trpc.system.transcribeAudio.useMutation();
  const ocrImage = trpc.system.ocrImage.useMutation();

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

  const handleEditorChange = useCallback(
    (markdown: string) => {
      bodyRef.current = markdown;
      triggerAutoSave(markdown, title);
    },
    [triggerAutoSave, title],
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setTitle(next);
      triggerAutoSave(bodyRef.current, next);
    },
    [triggerAutoSave],
  );

  const handleManualSave = useCallback(
    async (md: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      try {
        await updateNote(note.id, title, md);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    },
    [note.id, title, updateNote],
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
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          className="w-full bg-transparent text-2xl font-bold leading-tight outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder="Sans titre"
          aria-label="Titre de la note"
        />

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
          {note.tags.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Tag size={13} style={{ color: "var(--text-muted)" }} />
              <div className="flex flex-wrap gap-1">
                {note.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          <DropHint status={dropStatus} />
          <SaveIndicator status={saveStatus} />
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-y-auto px-10 py-6">
        <SupernoteEditor
          initialMarkdown={note.body}
          onChange={handleEditorChange}
          onSave={handleManualSave}
          className="min-h-[60vh] w-full"
        />
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
