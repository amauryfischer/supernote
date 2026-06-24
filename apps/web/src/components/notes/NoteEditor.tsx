"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/react";
import dynamic from "next/dynamic";
import { CaretDown, CaretRight, Calendar, Tag, FloppyDisk, Microphone, Image, Sparkle, X, CheckCircle, WarningCircle, Presentation, FilePdf } from "@phosphor-icons/react";
import Link from "next/link";
import { Fragment } from "react";
import { TagSelector } from "@/components/tags/TagSelector";
import { formatRelativeDate, type Note } from "./fixtures";
import { useUpdateNote } from "./hooks";
import type { SupernoteEditorProps, EntityRef, StreamingInsertHandle } from "@supernote/editor";
import { createOllamaClient } from "@supernote/ai/ollama";
import type { AIActionId } from "@supernote/ai/actions";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import {
  isAutoTitleEnabled,
  isDefaultTitle,
  useAutoTitle,
  resolveModel,
  readOllamaHost,
} from "@/hooks/useAutoTitle";
import { PromptModal } from "@/components/shell/PromptModal";
import { isAutoTagEnabled, useAutoTag } from "@/hooks/useAutoTag";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { breadcrumb } from "@/lib/diagnostics/freeze-watchdog";
import { AssociatedTodos } from "@/components/todos/AssociatedTodos";
import { renderInlineDatabase } from "./InlineDatabaseRenderer";
import { renderNoteFormula, NoteFormulaModalHost } from "./NoteFormulaBridge";
import { renderNotePortal } from "./NotePortal";
import { renderDoodle } from "./DoodleRenderer";
import { renderGoogleSheet } from "./GoogleSheetView";
import { renderGmailMessage } from "./GmailMessageView";
import { GmailPickerModal } from "./GmailPickerModal";
import { ShortcutsCheatSheet } from "./ShortcutsCheatSheet";
import { AmbianceSelector, ambianceClass, asAmbiance, asTypo, type NoteAmbiance, type NoteTypo } from "./AmbianceSelector";
import { CoverBackdrop, CoverButton, asCover } from "./NoteCover";
import { NoteIcon, IconButton, asIcon } from "./NoteIcon";
import { AiMarginsPanel } from "./AiMarginsPanel";
import { bestBlockMatchIndex } from "@/lib/ai/blockComments";
import { PresentationMode } from "./PresentationMode";
import { ContextMenu, useContextMenu, type ContextMenuItemDef } from "@supernote/ui";
import { MoveNoteModal } from "./MoveNoteModal";
import { useFolderTree, useRenameFolder } from "./hooks";
import { useRouter } from "next/navigation";
import { useSettings } from "@/components/settings/SettingsContext";
import { useDateFormat } from "@/lib/dateFormat";
import { useEditorBindings } from "@/lib/editor-shortcuts/useEditorBindings";

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
  /** Typewriter focus — dim every block except the one holding the caret.
   *  Wired by the page to its focus mode. */
  dimBlocks?: boolean;
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

/** Préférence globale : rangée métadonnées dépliée ou repliée (repliée par défaut). */
const META_BAR_STORAGE_KEY = "supernote.notes.metaBarOpen";

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

/** Map a MIME image type to a file extension for clipboard pastes. */
function imageTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
    "image/svg+xml": "svg",
  };
  return map[mimeType] ?? mimeType.split("/")[1] ?? "png";
}

export function NoteEditor({ note, dimBlocks = false }: NoteEditorProps) {
  // Mobile focus mode: drop the editor's formatting toolbar while the keyboard
  // is up so only the note content remains (the shell chrome is hidden by
  // MobileShell on the same signal).
  const isMobile = useIsMobile();
  const keyboardOpen = useKeyboardOpen();
  const hideToolbarForKeyboard = isMobile && keyboardOpen;
  const [title, setTitle] = useState(note.title);
  // Couverture posée → sert de fond au bloc titre (cf. CoverBackdrop). Repliée
  // pendant l'édition clavier mobile (focus = espace maximal).
  const [tags, setTags] = useState<string[]>(note.tags);
  const [ambiance, setAmbiance] = useState<NoteAmbiance>(() => asAmbiance(note.fields?.["ambiance"]));
  const [typo, setTypo] = useState<NoteTypo>(() => asTypo(note.fields?.["typo"]));
  const [cover, setCover] = useState<string | null>(() => asCover(note.fields?.["cover"]));
  const coverActive = Boolean(cover) && !hideToolbarForKeyboard;
  const [icon, setIcon] = useState<string | null>(() => asIcon(note.fields?.["icon"]));
  // Rangée métadonnées (date, tags, ambiance, actions) repliée par défaut —
  // dépliable via le handle discret sous le hero. Préférence globale, pas par note.
  const [metaOpen, setMetaOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(META_BAR_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleMetaBar = useCallback(() => {
    setMetaOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(META_BAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // stockage indisponible (navigation privée) — préférence non persistée
      }
      return next;
    });
  }, []);

  const handleCoverChange = useCallback(
    (next: string | null): void => {
      setCover(next);
      void trpcVanillaClient.entities.update.mutate({ id: note.id, fields: { cover: next ?? "" } });
    },
    [note.id],
  );
  const handleIconChange = useCallback(
    (next: string | null): void => {
      setIcon(next);
      void trpcVanillaClient.entities.update.mutate({ id: note.id, fields: { icon: next ?? "" } });
    },
    [note.id],
  );
  const [aiMargins, setAiMargins] = useState<boolean>(() => note.fields?.["aiMargins"] === true);
  const [bodyVersion, setBodyVersion] = useState(0);
  const [presenting, setPresenting] = useState(false);
  // Surlignage du bloc correspondant au commentaire IA survolé (overlay hors
  // subtree ProseMirror — jamais de mutation d'attribut dans l'éditeur).
  const editorColRef = useRef<HTMLDivElement>(null);
  const [blockHighlight, setBlockHighlight] = useState<{ top: number; height: number } | null>(null);
  // Texte du bloc contenant le caret → le panneau surligne le commentaire lié.
  const [activeBlockText, setActiveBlockText] = useState<string | null>(null);
  // Corps appliqué localement (correction IA) — sert d'initialMarkdown au
  // remount pour refléter le fix immédiatement, avant le round-trip de save.
  const [pendingBody, setPendingBody] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [dropStatus, setDropStatus] = useState<DropStatus>("idle");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [titleAiBadge, setTitleAiBadge] = useState(false);
  const [tagsAiBadge, setTagsAiBadge] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  // Move-to-folder: opened from the breadcrumb's right-click menu.
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  // Cheat-sheet des raccourcis éditeur — ouverte via `?` hors d'un champ éditable.
  const [cheatOpen, setCheatOpen] = useState(false);
  // Bumped when the note's body changes externally (e.g. another tab or the
  // /todos page rewriting a checkbox state). Used as part of the editor's
  // `key` so the BlockNote instance fully remounts with the new content —
  // BlockNote's `initialContent` is captured once at mount and never
  // reactively syncs to subsequent prop changes.
  const [externalBodyVersion, setExternalBodyVersion] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTitleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTagTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<string>(note.body);
  const titleRef = useRef<string>(note.title);
  const tagsRef = useRef<string[]>(note.tags);
  // Last body string we successfully sent to the server. The
  // external-change useEffect below uses it to silence its own save echo:
  // without this, typing during a save round-trip would race the refetched
  // body and force a BlockNote remount that drops the in-flight keystrokes.
  const lastSavedBodyRef = useRef<string | null>(note.body);
  const editorInsertRef = useRef<((md: string) => void) | null>(null);
  // Factory exposed by SupernoteEditor to insert AI answers token by token.
  const editorStreamRef = useRef<(() => StreamingInsertHandle) | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);

  // Bloc embed Gmail (Phase 2) : le bloc appelle `pickEmail()` qui ouvre une
  // modal EmailPicker ; on résout la promesse avec le threadId choisi (ou null
  // si annulé) via un ref-resolver.
  const [gmailPickerOpen, setGmailPickerOpen] = useState(false);
  const gmailResolveRef = useRef<((id: string | null) => void) | null>(null);
  const pickEmail = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        gmailResolveRef.current = resolve;
        setGmailPickerOpen(true);
      }),
    [],
  );
  const handleGmailSelect = useCallback((id: string) => {
    setGmailPickerOpen(false);
    gmailResolveRef.current?.(id);
    gmailResolveRef.current = null;
  }, []);
  const handleGmailCancel = useCallback(() => {
    setGmailPickerOpen(false);
    gmailResolveRef.current?.(null);
    gmailResolveRef.current = null;
  }, []);
  const gmailEmbed = useMemo(() => ({ render: renderGmailMessage, pickEmail }), [pickEmail]);
  // Mirror saveStatus into a ref so the external-body guard below can read
  // the latest status without re-running the effect on every status flip
  // (which would otherwise re-evaluate the remount decision the moment a
  // save transitions back to "idle", potentially racing a stale refetch).
  const saveStatusRef = useRef<SaveStatus>("idle");

  const { updateNote } = useUpdateNote();
  const { suggest: suggestTitle, isAvailable: ollamaAvailable } = useAutoTitle();
  const { suggest: suggestTags } = useAutoTag();
  // Notes-derived todos are now pure projections of the markdown — see
  // `extractChecklists` + `inlineMetadata`. No sync hook, no entity
  // duplication, no debounced "reconcile" pass to fight against the body
  // autosave. AssociatedTodos reads `note.body` directly.
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

  // User-chosen calendar pattern from Settings → Général → Format de date.
  // Used to format the "Modifié …" footer below; the relative branch
  // (Aujourd'hui / Hier / Il y a N jours) ignores it by design.
  const { settings } = useSettings();
  const dateFormatPref = settings.general.dateFormat;
  const { getBindings, bindingsKey } = useEditorBindings();

  // ── AI inline actions wiring ───────────────────────────────────────────────
  const aiClient = useMemo(() => createOllamaClient({}), []);
  const aiPromptResolver = useCallback(
    async (id: AIActionId) => {
      const res = await trpcVanillaClient.ai.getPrompt.query({ actionId: id });
      return res.prompt;
    },
    [],
  );
  const onAIError = useCallback(
    (err: { code: string; message: string }) => {
      showToast(
        err.code === "ollama_chat_failed"
          ? "Ollama indisponible. Lancer `ollama serve`."
          : err.message,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const onAIWarning = useCallback((msg: string) => {
    showToast(msg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Move-to-folder wiring ──────────────────────────────────────────────────
  const router = useRouter();
  const ctxMenu = useContextMenu();
  const { folders } = useFolderTree();
  // Flatten the folder tree into a list of full slash-paths for the picker.
  const folderPaths = useMemo(() => {
    const out: string[] = [];
    function walk(nodes: typeof folders) {
      for (const f of nodes) {
        out.push(f.path);
        if (f.children && f.children.length > 0) walk(f.children);
      }
    }
    walk(folders);
    return out;
  }, [folders]);
  const moveMutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      // utilsForTags is the same registry as `utils` further down — both
      // come from the single tRPC react context. Reusing the earlier
      // reference keeps the move handler self-contained.
      void utilsForTags.entities.get.invalidate({ id: note.id });
      void utilsForTags.entities.list.invalidate({ typeId: "note" });
      void utilsForTags.vault.folders.list.invalidate();
    },
  });

  // Inline rename of any breadcrumb segment. Reuses the same vault.folders.rename
  // mutation as the FileTree — the worker cascades the rename to every nested
  // .md file, so the open note's filePath updates automatically.
  const { renameFolder } = useRenameFolder();
  const handleRenameBreadcrumbFolder = useCallback(
    async (oldFullPath: string, newName: string) => {
      const cleaned = newName.trim().replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
      if (!cleaned) return;
      const parts = oldFullPath.split("/");
      parts[parts.length - 1] = cleaned;
      const newFullPath = parts.join("/");
      if (newFullPath === oldFullPath) return;
      try {
        await renameFolder(oldFullPath, newFullPath);
        // Sync the URL so `?folder=…` no longer points at a defunct path.
        // The note itself is already at its new filePath thanks to the worker
        // cascade — query invalidations refresh the editor view.
        if (
          note.folderPath === oldFullPath ||
          note.folderPath.startsWith(`${oldFullPath}/`)
        ) {
          const nextFolder =
            newFullPath + note.folderPath.slice(oldFullPath.length);
          router.replace(
            `/notes/${note.id}?folder=${encodeURIComponent(nextFolder)}`,
          );
        }
      } catch (err) {
        console.error("[NoteEditor.handleRenameBreadcrumbFolder] failed", err);
      }
    },
    [note.id, note.folderPath, renameFolder, router],
  );
  const handleConfirmMove = useCallback(
    async (nextFolder: string) => {
      setMoveModalOpen(false);
      if (nextFolder === note.folderPath) return;
      // Falls back to a slugified title when filePath is absent (demo mode).
      // In real PWA usage `note.filePath` is always present from the worker.
      const filename =
        note.filePath?.split("/").pop() ??
        `${note.title.toLowerCase().replace(/\s+/g, "-").slice(0, 80) || "sans-titre"}.md`;
      const nextFilePath = `${nextFolder}/${filename}`;
      try {
        await moveMutation.mutateAsync({ id: note.id, filePath: nextFilePath });
        showToast(`Note déplacée dans ${nextFolder}`);
        // Sync the URL so the FileTree highlight follows the note. We replace
        // (not push) — the user's history stack stays meaningful.
        router.replace(`/notes/${note.id}?folder=${encodeURIComponent(nextFolder)}`);
      } catch (err) {
        showToast(
          `Erreur lors du déplacement : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [note.id, note.filePath, note.folderPath, moveMutation, router],
  );
  const openBreadcrumbContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const items: ContextMenuItemDef[] = [
        {
          key: "move",
          label: "Déplacer dans un autre dossier…",
          onPress: () => setMoveModalOpen(true),
        },
      ];
      ctxMenu.open(e, items);
    },
    [ctxMenu],
  );

  // Reset state when switching to a different note. We key on `note.id` only
  // so a tRPC re-fetch of the *same* note (after auto-save) doesn't wipe the
  // AI badges or clobber the unsaved local title/body the user is mid-edit.
  useEffect(() => {
    titleRef.current = note.title;
    bodyRef.current = note.body;
    tagsRef.current = note.tags;
    lastSavedBodyRef.current = note.body;
    setTitle(note.title);
    setTags(note.tags);
    setTitleAiBadge(false);
    setTagsAiBadge(false);
    setPendingBody(null);
    // Réglages visuels par note (persistés dans `fields`) : les useState
    // initializers ne tournent qu'au mount, or l'éditeur ne remonte PAS quand
    // on passe d'une note à l'autre. Sans ce re-sync, le thème/couverture de la
    // note précédente reste affiché → effet « non enregistré » alors que la
    // valeur est bien sur disque. On relit donc depuis note.fields à chaque
    // changement de note.id.
    setAmbiance(asAmbiance(note.fields?.["ambiance"]));
    setTypo(asTypo(note.fields?.["typo"]));
    setCover(asCover(note.fields?.["cover"]));
    setIcon(asIcon(note.fields?.["icon"]));
    setAiMargins(note.fields?.["aiMargins"] === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Detect *external* body rewrites — e.g. /todos toggling a `- [ ]` to
  // `- [x]` in this note. We compare the latest fetched body against what
  // the editor's onChange last reported via `bodyRef.current`. If they
  // diverge it means someone outside the editor mutated the body, and we
  // bump `externalBodyVersion` to force BlockNote to remount with the new
  // content (BlockNote's `initialContent` is read only at mount).
  useEffect(() => {
    // While the user is mid-edit (debounce armed OR a save in flight) any
    // "external" body must be stale by definition — the worker can't have a
    // newer copy than what's already in `bodyRef`. Skipping the remount here
    // is what prevents the keystrokes-jumping-back symptom: without this
    // guard, a tag-update (or any concurrent invalidation of `entities.get`)
    // refetched the note with the previously-saved body, which differed from
    // what the user had just typed, and we forced BlockNote to remount with
    // that stale content — losing every in-flight keystroke.
    if (debounceRef.current !== null) return;
    if (saveStatusRef.current === "saving") return;
    // Echo of our own save — the user may have kept typing meanwhile, so
    // bodyRef can legitimately diverge from note.body. Don't remount.
    if (note.body === lastSavedBodyRef.current) return;
    // Tolerate trivial round-trip diffs (trailing newline / whitespace) that
    // SQLite/markdown serialization layers can introduce. Remounting on
    // those would still drop the cursor for no semantic reason.
    if (note.body.trimEnd() === (lastSavedBodyRef.current ?? "").trimEnd()) {
      lastSavedBodyRef.current = note.body;
      return;
    }
    if (note.body !== bodyRef.current) {
      bodyRef.current = note.body;
      setPendingBody(null); // un vrai changement externe prime sur un fix local
      setExternalBodyVersion((v) => v + 1);
    }
  }, [note.body]);

  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  // `?` key → cheat-sheet des raccourcis éditeur (hors champ éditable).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      const el = document.activeElement;
      if (!el) return;
      const tag = el.tagName.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        (el as HTMLElement).getAttribute("contenteditable") === "true"
      )
        return;
      e.preventDefault();
      setCheatOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Cleanup timers on unmount + flush any pending body save so navigating
  // away from the note doesn't drop the latest keystrokes on the floor.
  useEffect(() => {
    return () => {
      if (autoTitleTimer.current) clearTimeout(autoTitleTimer.current);
      if (autoTagTimer.current) clearTimeout(autoTagTimer.current);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        void updateNote(note.id, titleRef.current, bodyRef.current);
      }
    };
  }, [updateNote, note.id]);

  // Flush a pending debounced save the moment the tab is hidden or the page
  // is being torn down (refresh, close, PWA switch). Without this, up to
  // DEBOUNCE_MS of typing silently dies with the tab.
  useEffect(() => {
    const flush = () => {
      if (debounceRef.current === null) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      lastSavedBodyRef.current = bodyRef.current;
      void updateNote(note.id, titleRef.current, bodyRef.current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    };
  }, [note.id, updateNote]);

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
      // Hover-preview d'un [[wikilink]] : résout le nom → entité, puis lit
      // le body complet pour en tirer un extrait plein-texte (la recherche
      // ne renvoie que des résumés sans body).
      previewEntity: async (name: string) => {
        try {
          const res = await utils.entities.search.fetch({ query: name, limit: 1 });
          const hit = res.items[0];
          if (!hit) return null;
          const full = await utils.entities.get.fetch({ id: hit.id });
          const body = typeof (full as { body?: unknown }).body === "string"
            ? ((full as { body: string }).body)
            : "";
          const excerpt = body
            .replace(/[#>*`~_\[\]|-]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 280);
          return { title: entityDisplayName(full), excerpt };
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
        // Clear the debounce ref so the external-body guard knows no save
        // is currently armed. We're committed to this run from here on.
        debounceRef.current = null;
        // Optimistically mark this body as "ours" BEFORE awaiting the
        // mutation. The vault tRPC link runs in a Web Worker — the refetch
        // triggered by `entities.get.invalidate` inside `useUpdateNote.onSuccess`
        // can land in the same microtask burst as the resolved mutation, so
        // setting the ref *after* the await loses the race and forces a
        // BlockNote remount that eats keystrokes.
        lastSavedBodyRef.current = markdown;
        try {
          await updateNote(note.id, updatedTitle, markdown);
          setSaveStatus("saved");
          document.dispatchEvent(
            new CustomEvent("supernote:ui-sound", { detail: { kind: "save" } }),
          );
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
          // Persistent — an unsaved-note error must stay visible until the
          // next save attempt clears it, not vanish after 3s while the user
          // is looking elsewhere.
          setSaveStatus("error");
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

  // ── Clipboard image paste ─────────────────────────────────────────────────
  //
  // Listens for `paste` events on the editor container. When the clipboard
  // contains an image item, saves it to <noteDir>/_attachments/img-<ts>.<ext>
  // via vault.writeFile, then inserts a markdown image reference at the caret.
  // We only handle image items — text/html pastes fall through to BlockNote.
  const noteFilePathRef = useRef<string | undefined>(note.filePath);
  useEffect(() => {
    noteFilePathRef.current = note.filePath;
  }, [note.filePath]);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const handlePaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));
      if (imageItems.length === 0) return;

      event.preventDefault();

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        const ext = imageTypeToExt(item.type);
        const filePath = noteFilePathRef.current;
        // Derive folder from filePath, fallback to folderPath from closure.
        const noteDir = filePath
          ? filePath.split("/").slice(0, -1).join("/") || "."
          : note.folderPath || ".";
        const attachmentPath = `${noteDir === "." ? "" : `${noteDir}/`}_attachments/img-${Date.now()}.${ext}`;
        const markdownRef = `![](${attachmentPath})`;

        void (async () => {
          try {
            const bytes = await file.arrayBuffer();
            await trpcVanillaClient.vault.writeFile.mutate({ path: attachmentPath, bytes });
            insertMarkdown(markdownRef);
            showToast("Image collée");
          } catch (err) {
            console.error("[NoteEditor.paste] image write failed", err);
            showToast(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
      }
    };

    container.addEventListener("paste", handlePaste);
    return () => container.removeEventListener("paste", handlePaste);
  // note.folderPath is used inside closure — include it. insertMarkdown and
  // showToast are stable callbacks (useCallback / plain function). We
  // intentionally omit them from deps to avoid re-registering on every save.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.folderPath]);

  const handleEditorChange = useCallback(
    (markdown: string) => {
      breadcrumb("edit:note");
      bodyRef.current = markdown;
      triggerAutoSave(markdown, title);
      scheduleAutoTitle(markdown);
      scheduleAutoTag(markdown);
      // Tick léger pour réveiller les marges IA (debounce côté panneau).
      if (aiMargins) setBodyVersion((v) => v + 1);
    },
    [triggerAutoSave, title, scheduleAutoTitle, scheduleAutoTag, aiMargins],
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      titleRef.current = next;
      setTitle(next);
      // Live-sync the title into the notes list cache so the middle column
      // follows each keystroke instead of waiting for the debounced save +
      // refetch round-trip. Order/updatedAt left untouched — resorting the
      // list under the user's cursor mid-typing would be jarring.
      utilsForTags.entities.list.setData(
        { typeId: "note", limit: 500, offset: 0 },
        (old) =>
          old
            ? {
                ...old,
                items: old.items.map((it) =>
                  it.id === note.id
                    ? { ...it, fields: { ...it.fields, title: next } }
                    : it,
                ),
              }
            : old,
      );
      // User is editing the title — drop the AI badge.
      if (titleAiBadge) setTitleAiBadge(false);
      // Cancel any pending auto-title since the user just took control.
      if (autoTitleTimer.current) clearTimeout(autoTitleTimer.current);
      triggerAutoSave(bodyRef.current, next);
    },
    [triggerAutoSave, titleAiBadge, utilsForTags, note.id],
  );

  const handleManualSave = useCallback(
    async (md: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setSaveStatus("saving");
      lastSavedBodyRef.current = md;
      try {
        await updateNote(note.id, title, md);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        // Persistent until the next save attempt — see triggerAutoSave.
        setSaveStatus("error");
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

  // Survol d'un commentaire IA → retrouve le bloc dans l'éditeur (matching
  // texte), le centre et positionne un overlay de surlignage. Lecture DOM
  // seule + overlay sibling : aucune mutation du subtree observé par PM.
  const handleHoverBlock = useCallback((blockText: string | null) => {
    if (!blockText) { setBlockHighlight(null); return; }
    const col = editorColRef.current;
    if (!col) return;
    const els = Array.from(col.querySelectorAll<HTMLElement>(".bn-block-content"));
    if (els.length === 0) return;
    const idx = bestBlockMatchIndex(blockText, els.map((e) => e.textContent ?? ""));
    if (idx < 0) { setBlockHighlight(null); return; }
    const el = els[idx]!;
    const colRect = col.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    setBlockHighlight({ top: elRect.top - colRect.top, height: elRect.height });
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Suit le bloc actif (caret) pour surligner son commentaire dans la marge.
  // Lecture DOM seule (selectionchange) — aucune mutation du subtree PM.
  useEffect(() => {
    if (!aiMargins) { setActiveBlockText(null); return undefined; }
    const onSel = () => {
      const col = editorColRef.current;
      const sel = document.getSelection();
      const node = sel?.anchorNode;
      if (!col || !node || !col.contains(node)) return;
      let el: Element | null = node instanceof Element ? node : node.parentElement;
      while (el && el !== col && !el.classList?.contains("bn-block-content")) {
        el = el.parentElement;
      }
      const text = el?.classList?.contains("bn-block-content") ? (el.textContent ?? "") : null;
      setActiveBlockText((prev) => (prev === text ? prev : text));
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [aiMargins]);

  // Applique une correction IA : remplace le bloc dans le markdown, force le
  // remount de l'éditeur avec le nouveau contenu, et persiste.
  const handleApplyFix = useCallback((oldText: string, newText: string) => {
    const body = bodyRef.current;
    const idx = body.indexOf(oldText);
    if (idx === -1) return; // bloc déplacé/modifié entre-temps — abandon silencieux
    const updated = body.slice(0, idx) + newText + body.slice(idx + oldText.length);
    bodyRef.current = updated;
    setBlockHighlight(null);
    setPendingBody(updated);
    setExternalBodyVersion((v) => v + 1); // remount BlockNote avec le fix
    triggerAutoSave(updated, title);
  }, [triggerAutoSave, title]);

  const handleAskAi = useCallback(() => {
    setAiModalOpen(true);
  }, []);

  const handleAiSubmit = useCallback(async (userPrompt: string) => {
    const trimmed = userPrompt.trim();
    if (!trimmed) {
      setAiModalOpen(false);
      return;
    }
    setAiModalOpen(false);
    setAiLoading(true);
    try {
      const host = readOllamaHost();
      const model = await resolveModel(host);
      if (!model) {
        showToast("Ollama indisponible ou aucun modèle installé");
        return;
      }
      const contextSnippet = bodyRef.current.trim().slice(0, 1500);
      const prompt = contextSnippet
        ? `Tu es un assistant. Réponds en français.\n\nContexte de la note (titre: "${titleRef.current}"):\n${contextSnippet}\n\nQuestion ou instruction:\n${trimmed}`
        : `Tu es un assistant. Réponds en français.\n\nQuestion ou instruction:\n${trimmed}`;

      // Streaming : la réponse s'écrit mot à mot dans la note au lieu
      // d'atterrir d'un bloc à la fin. fetch direct (pas fetchWithTimeout :
      // un timeout qui aborte couperait le stream en cours) — l'AbortController
      // borne le temps TOTAL à 90s, largement au-delà d'une réponse normale.
      const canStream = !!editorStreamRef.current;
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 90_000);
      try {
        const res = await fetch(`${host}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt,
            stream: canStream,
            options: { temperature: 0.7 },
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          showToast(`Erreur Ollama (${res.status})`);
          return;
        }
        if (!canStream || !res.body) {
          // Fallback non-stream (éditeur pas prêt) — comportement historique.
          const data = (await res.json()) as { response?: string };
          const text = (data.response ?? "").trim();
          if (!text) {
            showToast("Ollama n'a retourné aucune réponse");
            return;
          }
          insertMarkdown(text);
          return;
        }
        const handle = editorStreamRef.current!();
        setAiLoading(false); // le texte arrive — plus besoin du toast "réfléchit"
        let received = false;
        try {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let pending = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            // Ollama répond en NDJSON — un objet {response, done} par ligne.
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const data = JSON.parse(line) as { response?: string };
                if (data.response) {
                  handle.append(data.response);
                  received = true;
                }
              } catch {
                /* ligne partielle / bruit — ignorée */
              }
            }
          }
          if (received) {
            handle.end();
          } else {
            handle.cancel();
            showToast("Ollama n'a retourné aucune réponse");
          }
        } catch (err) {
          handle.cancel();
          throw err;
        }
      } finally {
        clearTimeout(abortTimer);
      }
    } catch (err) {
      console.warn("[askAi]", err);
      showToast("Ollama indisponible — démarrez avec OLLAMA_ORIGINS=* ollama serve");
    } finally {
      setAiLoading(false);
    }
  }, [insertMarkdown]);

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

  const isDropping = dropStatus === "audio-over" || dropStatus === "image-over";

  return (
    <div
      className={`flex h-full flex-col overflow-hidden ${ambianceClass(ambiance, typo)}`}
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
      {(toastMsg || aiLoading) && (
        <div
          className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {aiLoading ? "L'IA réfléchit…" : toastMsg}
        </div>
      )}

      <PromptModal
        open={aiModalOpen}
        title="Demander à l'IA"
        placeholder="Votre question ou instruction…"
        confirmLabel="Envoyer"
        onConfirm={(value) => { void handleAiSubmit(value); }}
        onCancel={() => setAiModalOpen(false)}
      />

      {/* Header — la couverture sert de FOND au bloc titre (breadcrumb + titre),
          façon Notion : « en background », pas en bandeau séparé au-dessus.
          Masqué pendant l'édition clavier mobile (cf. focus clavier). */}
      <div
        className="sn-no-print"
        style={{ display: hideToolbarForKeyboard ? "none" : undefined }}
      >
        {/* Hero : breadcrumb + titre posés SUR la couverture (si présente). */}
        <div
          className={`sn-note-hero group relative px-4 pb-4 pt-4 md:px-10 md:pb-5 md:pt-6${
            coverActive ? " sn-note-hero--cover flex flex-col justify-end" : ""
          }`}
        >
          {coverActive && <CoverBackdrop coverId={cover} onChange={handleCoverChange} />}
          <div className="relative z-10">
            <FolderBreadcrumb
              path={note.folderPath}
              onContextMenu={openBreadcrumbContextMenu}
              onRenameFolder={handleRenameBreadcrumbFolder}
            />
            <div className="flex items-center gap-2">
          {icon && <NoteIcon icon={icon} onChange={handleIconChange} />}
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            className="sn-note-title w-full bg-transparent text-xl font-bold leading-tight outline-none"
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
            <Button
              variant="ghost"
              size="sm"
              onPress={runSuggestTitle}
              isDisabled={isSuggesting}
              className="h-7 min-w-0 shrink-0 gap-1 rounded border px-2 text-xs hover:opacity-80 disabled:opacity-50"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
                backgroundColor: "var(--surface-1)",
              }}
              aria-label="Suggérer un titre"
            >
              <Sparkle size={12} />
              {isSuggesting ? "..." : "Suggérer un titre"}
            </Button>
          )}
            </div>
          </div>
        </div>

        {/* Métadonnées (date, tags, ambiance, actions) — repliées par défaut,
            dépliables via le handle discret posé sur la bordure ci-dessous. */}
        <div className="sn-meta-collapse" data-open={metaOpen ? "true" : "false"} id="note-meta-bar">
          <div className="sn-meta-collapse__inner">
            <div className="px-4 pb-4 pt-3 md:px-10 md:pb-6">
              <div className="flex flex-wrap items-center gap-3">
          <EditableNoteDate
            noteId={note.id}
            fallbackDate={note.updatedAt}
            customDate={
              typeof note.fields?.["noteDate"] === "string"
                ? (note.fields["noteDate"] as string)
                : null
            }
          />
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
          <AmbianceSelector
            noteId={note.id}
            value={ambiance}
            typo={typo}
            onChange={setAmbiance}
            onTypoChange={setTypo}
          />
          {!icon && <IconButton onChange={handleIconChange} />}
          {!cover && <CoverButton onChange={handleCoverChange} />}
          {ollamaAvailable && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                const next = !aiMargins;
                setAiMargins(next);
                if (next) setBodyVersion((v) => v + 1);
                void trpcVanillaClient.entities.update.mutate({ id: note.id, fields: { aiMargins: next } });
              }}
              className="h-7 min-w-0 gap-1 px-2 text-xs"
              style={{ color: aiMargins ? "var(--accent)" : "var(--text-muted)" }}
              aria-label="Marges IA"
              aria-pressed={aiMargins}
            >
              <Sparkle size={13} weight={aiMargins ? "fill" : "regular"} />
              Marges IA
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setPresenting(true)}
            className="h-7 min-w-0 gap-1 px-2 text-xs"
            style={{ color: "var(--text-muted)" }}
            aria-label="Présenter la note"
          >
            <Presentation size={13} />
            Présenter
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => window.print()}
            className="h-7 min-w-0 gap-1 px-2 text-xs"
            style={{ color: "var(--text-muted)" }}
            aria-label="Exporter en PDF"
          >
            <FilePdf size={13} />
            PDF
          </Button>
          <DropHint status={dropStatus} />
          <SaveIndicator status={saveStatus} />
              </div>
            </div>
          </div>
        </div>

        {/* Séparateur header/éditeur + handle de dépliage des métadonnées. */}
        <div className="relative" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <Button
            variant="ghost"
            onPress={toggleMetaBar}
            aria-expanded={metaOpen}
            aria-controls="note-meta-bar"
            aria-label={metaOpen ? "Masquer les outils de la note" : "Afficher les outils de la note"}
            className="sn-meta-handle h-auto min-w-0 p-0"
          >
            <CaretDown
              size={11}
              className="sn-motion-glide"
              style={{ transform: metaOpen ? "rotate(180deg)" : undefined }}
            />
          </Button>
        </div>
      </div>

      {/* Editor area */}
      <div
        ref={editorContainerRef}
        className="flex-1 overflow-y-auto"
        onMouseDown={(e) => {
          // Click dans la zone padding hors block : routé vers le caret.
          // Position Y détermine si on focus le premier (clic au-dessus) ou
          // le dernier block (clic en-dessous) — sinon un clic sous une
          // base ramène absurdement le curseur en haut du document.
          const target = e.target as HTMLElement;
          if (
            target.closest(".bn-block-content") ||
            target.closest(".bn-side-menu") ||
            target.closest(".bn-formatting-toolbar") ||
            target.closest("[contenteditable=\"true\"]") ||
            target.closest("a, button, input, textarea, [role=\"button\"]")
          ) {
            return;
          }
          const currentTarget = e.currentTarget;
          const editable = currentTarget.querySelector<HTMLElement>(
            "[contenteditable=\"true\"]",
          );
          if (!editable) return;
          e.preventDefault();
          editable.focus();

          const blocks = editable.querySelectorAll<HTMLElement>(".bn-block-content");
          const firstBlock = blocks[0] ?? null;
          const lastBlock = blocks[blocks.length - 1] ?? null;
          // Click below the bottom of the last block → land at the end
          // (handles "clic loin sous la table"). Otherwise top of document.
          const goToEnd =
            lastBlock != null &&
            e.clientY > lastBlock.getBoundingClientRect().bottom;
          const targetBlock = goToEnd ? lastBlock : firstBlock;

          const range = document.createRange();
          range.selectNodeContents(targetBlock ?? editable);
          range.collapse(!goToEnd);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }}
      >
        <div className="flex gap-2 px-4 py-4 md:px-10 md:py-6">
          <div ref={editorColRef} className="relative min-w-0 flex-1">
            {blockHighlight && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 right-0 z-10 rounded-md transition-all duration-200"
                style={{
                  top: blockHighlight.top - 4,
                  height: blockHighlight.height + 8,
                  background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
                }}
              />
            )}
            <SupernoteEditor
              key={`${note.id}:${externalBodyVersion}:${bindingsKey}`}
              initialMarkdown={pendingBody ?? note.body}
              onChange={handleEditorChange}
              onSave={handleManualSave}
              resolvers={resolvers}
              className="min-h-[60vh] w-full"
              onAskAi={handleAskAi}
              dimInactiveBlocks={dimBlocks}
              onEditorReady={(insert) => { editorInsertRef.current = insert; }}
              onStreamingInsertReady={(begin) => { editorStreamRef.current = begin; }}
              renderDatabaseView={renderInlineDatabase}
              renderFormula={renderNoteFormula}
              renderEmbed={renderNotePortal}
              renderDoodle={renderDoodle}
              renderGoogleSheet={renderGoogleSheet}
              gmailEmbed={gmailEmbed}
              aiClient={aiClient}
              aiPromptResolver={aiPromptResolver}
              noteTitle={title}
              onAIError={onAIError}
              onAIWarning={onAIWarning}
              getKeymapBindings={getBindings}
            />
          </div>
          {aiMargins && (
            <div
              className="hidden w-[260px] shrink-0 lg:block"
              style={{ borderLeft: "1px solid var(--border-subtle)" }}
            >
              <AiMarginsPanel
                noteId={note.id}
                noteTitle={title}
                getBody={() => bodyRef.current}
                bodyVersion={bodyVersion}
                activeBlockText={activeBlockText}
                onHoverBlock={handleHoverBlock}
                onApplyFix={handleApplyFix}
              />
            </div>
          )}
        </div>
        {/* Read-only summary of todos extracted from this note. Pure
            projection of the markdown body — no extra fetch, no entities. */}
        <AssociatedTodos noteId={note.id} body={note.body} />
      </div>
      <NoteFormulaModalHost
        stubBase={{ id: "_note", name: "Note", plural: "Notes", fields: [], defaultPath: "", fileNamePattern: "{name}" }}
      />
      <GmailPickerModal
        isOpen={gmailPickerOpen}
        onSelect={handleGmailSelect}
        onClose={handleGmailCancel}
      />

      {presenting && (
        <PresentationMode
          markdown={bodyRef.current}
          title={title || "Sans titre"}
          onClose={() => setPresenting(false)}
        />
      )}

      {/* Couverture visible seulement à l'impression (export PDF). */}
      <div className="sn-print-cover" aria-hidden="true">
        <h1>{title || "Sans titre"}</h1>
        <p>{formatRelativeDate(note.updatedAt, dateFormatPref)}</p>
      </div>

      {/* Footer */}
      <div
        className="sn-no-print flex items-center justify-between px-4 py-3 md:px-10"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Modifié {formatRelativeDate(note.updatedAt, dateFormatPref).toLowerCase()}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Glissez un fichier audio ou image pour transcrire / OCR
        </span>
      </div>

      <MoveNoteModal
        open={moveModalOpen}
        folders={folderPaths}
        currentFolder={note.folderPath}
        onConfirm={(next) => void handleConfirmMove(next)}
        onCancel={() => setMoveModalOpen(false)}
      />
      <ShortcutsCheatSheet
        isOpen={cheatOpen}
        onClose={() => setCheatOpen(false)}
      />
      <ContextMenu state={ctxMenu.state} onClose={ctxMenu.close} />
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
  // Always mounted (even idle, at opacity 0) so state changes fade/slide
  // through CSS transitions instead of popping in and out of the DOM.
  // Styling lives in globals.css under `.sn-save-indicator`.
  const label =
    status === "saving"
      ? "Sauvegarde…"
      : status === "saved"
        ? "Enregistré"
        : status === "error"
          ? "Erreur de sauvegarde"
          : "";
  return (
    <div className="sn-save-indicator" data-status={status} aria-live="polite">
      <span className="sn-save-indicator__icon">
        {status === "error" ? (
          <WarningCircle size={12} weight="bold" />
        ) : status === "saved" ? (
          <CheckCircle size={12} weight="bold" />
        ) : (
          <FloppyDisk size={11} />
        )}
      </span>
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
    <div className="space-y-3 pt-2">
      {[100, 80, 90, 60].map((w, i) => (
        <div
          key={i}
          className="sn-shimmer h-4 rounded"
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

// ── Folder breadcrumb ─────────────────────────────────────────────────────────
//
// Path crumbs sitting just above the title — each segment is a link back to
// /notes filtered on that subtree, so the user can jump up the hierarchy
// without leaving the keyboard.

interface FolderBreadcrumbProps {
  path: string;
  /** Right-click handler — typically opens a context menu with a
   *  "Move note to another folder…" entry. Bound on the whole nav so the
   *  user can right-click any segment OR the empty area. */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Inline-rename callback. Receives the FULL old path (cumulative up to the
   *  edited segment) and the NEW leaf name. The parent computes the new full
   *  path and calls `vault.folders.rename`. */
  onRenameFolder?: (oldPath: string, newName: string) => Promise<void> | void;
}

function FolderBreadcrumb({
  path,
  onContextMenu,
  onRenameFolder,
}: FolderBreadcrumbProps) {
  const segments = path.split("/").filter((s) => s.length > 0);
  // editingIndex must always be declared (hook order); guard the early-return
  // on segments below it.
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  if (segments.length === 0) return null;
  const crumbs = segments.map((label, i) => ({
    label,
    cumulativePath: segments.slice(0, i + 1).join("/"),
    href: `/notes?folder=${encodeURIComponent(segments.slice(0, i + 1).join("/"))}`,
    isLast: i === segments.length - 1,
  }));

  const beginEdit = (i: number) => {
    if (!onRenameFolder) return;
    setEditingIndex(i);
  };
  const commit = async (i: number, value: string) => {
    setEditingIndex(null);
    const trimmed = value.trim().replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
    const old = crumbs[i]?.label ?? "";
    if (!trimmed || trimmed === old || !onRenameFolder) return;
    try {
      await onRenameFolder(crumbs[i]!.cumulativePath, trimmed);
    } catch {
      /* parent surfaces the error toast — nothing more to do here */
    }
  };

  return (
    <nav
      aria-label="Dossier"
      className="mb-1 flex flex-wrap items-center gap-0.5 text-xs"
      style={{ color: "var(--text-muted)" }}
      onContextMenu={onContextMenu}
      title={
        onContextMenu
          ? "Clic droit pour déplacer la note · double-clic sur un dossier pour le renommer"
          : undefined
      }
    >
      {crumbs.map((c, i) => (
        <Fragment key={c.href}>
          {i > 0 && (
            <CaretRight
              size={11}
              weight="bold"
              style={{ opacity: 0.4 }}
            />
          )}
          {editingIndex === i ? (
            <BreadcrumbRenameInput
              initialValue={c.label}
              onCommit={(v) => void commit(i, v)}
              onCancel={() => setEditingIndex(null)}
            />
          ) : c.isLast ? (
            // Single click on the current folder → edit (analogous to the
            // always-editable note title input above). Keeps the segment
            // visually inert until the user actually clicks it.
            <Button
              variant="ghost"
              size="sm"
              onPress={() => beginEdit(i)}
              onDoubleClick={() => beginEdit(i)}
              className="h-auto min-w-0 cursor-text rounded bg-transparent px-1 py-0.5 capitalize hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
              style={{ color: "var(--text-secondary)", fontWeight: 500 }}
              aria-label={onRenameFolder ? "Cliquer pour renommer" : c.label}
            >
              {c.label}
            </Button>
          ) : (
            // Parent segments keep navigation on single-click; double-click
            // opens the inline rename so the user can rename ancestors too.
            <Link
              href={c.href}
              onDoubleClick={(e) => {
                e.preventDefault();
                beginEdit(i);
              }}
              className="rounded px-1 py-0.5 capitalize transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
              title={onRenameFolder ? "Double-clic pour renommer" : undefined}
            >
              {c.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

interface BreadcrumbRenameInputProps {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function BreadcrumbRenameInput({
  initialValue,
  onCommit,
  onCancel,
}: BreadcrumbRenameInputProps) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(value)}
      // Single accent border + soft drop shadow for depth. `outline: none`
      // is set inline (not via Tailwind) because globals.css has a global
      // `:focus-visible { outline: 2px solid var(--accent) }` rule that
      // wins over Tailwind utilities — without the inline override, the
      // input rendered with both a border AND a focus outline (the user's
      // "double border" report).
      className="rounded border px-2 py-0.5 text-xs font-medium capitalize"
      style={{
        color: "var(--text-primary)",
        backgroundColor: "var(--surface-0)",
        borderColor: "var(--accent)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        outline: "none",
        minWidth: `${Math.max(value.length, 4) + 1}ch`,
      }}
      aria-label="Renommer le dossier"
    />
  );
}

// ── Editable note date ────────────────────────────────────────────────────────
//
// Displays the note's date (custom override stored in `fields.noteDate`,
// falling back to the auto-managed `updatedAt`). Click to backdate via a
// native date picker, with a "Réinitialiser" link to drop the override
// and fall back to the modification time. Persists silently in
// `entities.update({fields:{noteDate}})`.

interface EditableNoteDateProps {
  noteId: string;
  /** ISO datetime — auto-managed by the worker; used when no override is set. */
  fallbackDate: string;
  /** ISO YYYY-MM-DD or null. When set, displayed instead of fallbackDate. */
  customDate: string | null;
}

// Note: the header date pill now uses the user's preferred calendar pattern
// via `useDateFormat()` inside EditableNoteDate. The previous fr-FR-only
// long-form ("mardi 12 mai 2025") is gone — the setting from Paramètres
// → Général is the single source of truth.

/** Convert any ISO-ish input to "YYYY-MM-DD" for the native date input. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  // Already a calendar date — accept as-is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Pad month/day to 2 digits without timezone surprises.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function EditableNoteDate({
  noteId,
  fallbackDate,
  customDate,
}: EditableNoteDateProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => toDateInputValue(customDate ?? fallbackDate));
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const { full: formatFull } = useDateFormat();
  const mutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      void utils.entities.get.invalidate({ id: noteId });
      void utils.entities.list.invalidate({ typeId: "note" });
    },
  });

  // Re-seed the draft whenever the user opens the editor — they may have
  // changed something elsewhere (or we may be re-opening for a different
  // note) and we don't want to flash an obsolete value.
  useEffect(() => {
    if (editing) {
      setDraft(toDateInputValue(customDate ?? fallbackDate));
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [editing, customDate, fallbackDate]);

  const displaySource = customDate ?? fallbackDate;
  const displayLabel = formatFull(displaySource);
  const isOverridden = !!customDate;

  const commit = useCallback(
    async (nextValue: string | null) => {
      setEditing(false);
      // No-op when nothing actually changed.
      const current = customDate ?? "";
      const target = nextValue ?? "";
      if (current === target) return;
      try {
        await mutation.mutateAsync({
          id: noteId,
          fields: { noteDate: target || null },
        });
      } catch {
        /* silent — the date stays at its previous value */
      }
    },
    [customDate, mutation, noteId],
  );

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <Calendar size={13} style={{ color: "var(--accent)" }} />
        <input
          ref={inputRef}
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit(draft || null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className="bg-transparent text-xs outline-none"
          style={{
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "0.25rem",
            padding: "0.125rem 0.375rem",
          }}
          aria-label="Modifier la date affichée"
        />
        <button
          type="button"
          onClick={() => void commit(draft || null)}
          className="text-[10px] font-medium uppercase tracking-wide"
          style={{ color: "var(--accent)" }}
          aria-label="Enregistrer (Entrée)"
        >
          OK
        </button>
        {isOverridden && (
          <button
            type="button"
            onClick={() => void commit(null)}
            className="text-[10px] underline"
            style={{ color: "var(--text-muted)" }}
            aria-label="Réinitialiser à la date de modification"
          >
            Réinitialiser
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-[var(--surface-2)]"
      aria-label={
        isOverridden
          ? "Date personnalisée — clic pour modifier"
          : "Clic pour fixer une date personnalisée"
      }
    >
      <Calendar
        size={13}
        style={{ color: isOverridden ? "var(--accent)" : "var(--text-muted)" }}
      />
      <span
        className="text-xs"
        style={{
          color: isOverridden ? "var(--text-secondary)" : "var(--text-muted)",
          fontWeight: isOverridden ? 500 : 400,
        }}
      >
        {displayLabel}
      </span>
    </button>
  );
}

interface NoteTagsInputProps {
  noteId: string;
  tags: string[];
  onTagsChange: (next: string[]) => void;
  aiBadge?: boolean;
}

function NoteTagsInput({ noteId, tags, onTagsChange, aiBadge }: NoteTagsInputProps) {
  const utils = trpc.useUtils();
  // Brief inline status flash so the user sees that adding/removing a tag
  // actually persisted — without it the chip just appears and the user
  // wonders whether anything happened.
  const [savedFlash, setSavedFlash] = useState(false);
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      void utils.entities.get.invalidate({ id: noteId });
      void utils.entities.list.invalidate({ typeId: "note" });
      void utils.tags.list.invalidate();
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1400);
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
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              onPress={() => removeTag(tag)}
              aria-label={`Retirer le tag ${tag}`}
              className="h-4 w-4 min-w-0 bg-transparent p-0 opacity-70 hover:opacity-100"
            >
              <X size={9} weight="bold" />
            </Button>
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
        {(updateMutation.isPending || savedFlash || updateMutation.isError) && (
          <span
            className="ml-1 text-[10px] font-medium"
            style={{
              color: updateMutation.isError
                ? "var(--color-danger, #ef4444)"
                : updateMutation.isPending
                  ? "var(--text-muted)"
                  : "oklch(0.55 0.18 150)",
            }}
            aria-live="polite"
          >
            {updateMutation.isError
              ? "Erreur"
              : updateMutation.isPending
                ? "Enregistrement…"
                : "✓ Enregistré"}
          </span>
        )}
      </div>
    </div>
  );
}
