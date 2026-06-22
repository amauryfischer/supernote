"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, Input, Spinner } from "@heroui/react";
import { ArrowSquareOut } from "@phosphor-icons/react";

import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";
import { trpc } from "@/lib/trpc/client";
import { useSettings } from "@/components/settings/SettingsContext";
import {
  searchFiles,
  gdocMimeType,
  type DriveFile,
} from "@/lib/google-drive";

interface GDocPointer {
  url?: string;
  doc_id?: string;
  resource_id?: string;
}

type GDocType = "document" | "spreadsheets" | "presentation";

const EXT_TO_TYPE: Record<string, GDocType> = {
  ".gdoc": "document",
  ".gsheet": "spreadsheets",
  ".gslides": "presentation",
};

const TYPE_LABELS: Record<GDocType, string> = {
  document: "Google Docs",
  spreadsheets: "Google Sheets",
  presentation: "Google Slides",
};

function getExt(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

/**
 * Extract the doc id from any of the Google URL shapes Drive clients have
 * written over the years:
 *   - https://docs.google.com/document/d/ID/edit
 *   - https://docs.google.com/spreadsheets/d/ID/edit?usp=docslist_api
 *   - https://docs.google.com/open?id=ID
 *   - https://drive.google.com/file/d/ID/view
 *   - https://drive.google.com/uc?id=ID
 */
function docIdFromUrl(url: string): string | null {
  // /d/ID  →  match between /d/ and the next slash or end of URL
  const slashD = url.match(/\/d\/([a-zA-Z0-9_-]{8,})/);
  if (slashD?.[1]) return slashD[1];
  // ?id=ID or &id=ID
  try {
    const u = new URL(url);
    const id = u.searchParams.get("id");
    if (id && /^[a-zA-Z0-9_-]{8,}$/.test(id)) return id;
  } catch {
    // Not a valid URL — fall through.
  }
  return null;
}

/**
 * Build the iframe URL. We use `/edit?embedded=true` — Google supports
 * embedding the FULL EDITOR (not just read-only preview) inside an iframe
 * via this URL shape. The user keeps their normal Google session cookies
 * inside the frame, so editing works without any extra OAuth scope on
 * our side (the iframe IS the editor; we don't write through Drive API).
 *
 * `/preview` is read-only — used previously. If the user wants strictly
 * read-only (e.g. doc owner doesn't allow editing), Google's UI inside
 * the editor will fall back gracefully.
 */
function buildEmbedUrl(docId: string, type: GDocType): string {
  return `https://docs.google.com/${type}/d/${docId}/edit?embedded=true&rm=embedded`;
}

export function GDocViewer({ note, path }: AttachmentViewerProps) {
  const { loading, error, text } = useAttachmentBlob(path);
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      // Refetch the note so the freshly-persisted `gdocResolvedId` /
      // `gdocOverrideUrl` reaches this component via the `note` prop (sourced
      // from `entities.get` through `useNote`). Without this the resolved id is
      // written to the DB but never read back, so auto-resolution succeeds yet
      // the viewer stays stuck on the "non disponible localement" prompt.
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate();
    },
  });

  const basename = path.split("/").pop() ?? path;
  const ext = getExt(path);
  const docType: GDocType = EXT_TO_TYPE[ext] ?? "document";

  // User-pasted URL override — persisted on the entity via
  // `fields.gdocOverrideUrl` so it survives refresh. Lets users bypass the
  // FSA-can't-read-cloud-placeholder problem by pointing us straight at
  // the doc URL.
  const overrideUrl =
    typeof note.fields?.["gdocOverrideUrl"] === "string"
      ? (note.fields["gdocOverrideUrl"] as string)
      : null;

  // Auto-resolved doc id from Google Drive search — once we've matched
  // a Drive file by name we cache its id here so subsequent loads skip
  // the search entirely. Set by the resolution effect below.
  const resolvedId =
    typeof note.fields?.["gdocResolvedId"] === "string"
      ? (note.fields["gdocResolvedId"] as string)
      : null;

  // ── Drive auto-resolution effect ───────────────────────────────────────
  // Triggered when the file read failed AND the user has Drive connected
  // AND we don't already have an override or a cached resolved id. Calls
  // Drive's `files.list` to find a doc with the matching name + mimeType,
  // then persists the id on the entity so subsequent loads skip the API.
  const { settings } = useSettings();
  const driveClientId = settings.googleDrive?.clientId?.trim() ?? "";
  const driveConnected = !!settings.googleDrive?.connectedEmail;
  const [autoResolveStatus, setAutoResolveStatus] = useState<
    "idle" | "searching" | "no-match" | "multi-match" | "error" | "done"
  >("idle");
  const [autoResolveError, setAutoResolveError] = useState<string | null>(null);
  const [autoMatches, setAutoMatches] = useState<DriveFile[]>([]);

  // Trigger auto-resolution when the local file is unreadable OR its
  // content is empty/garbage — both result in `parsed` being null but we
  // can still try to find the doc in Drive by name.
  const readSucceededButParseFailed =
    !loading && !error && (!text || text.trim().length === 0);
  const shouldAutoResolve =
    !loading &&
    !overrideUrl &&
    !resolvedId &&
    !!driveClientId &&
    driveConnected &&
    (!!error || readSucceededButParseFailed);

  useEffect(() => {
    console.info(
      `[GDocViewer] auto-resolve gate path=${path} error=${!!error} readSucceededButParseFailed=${readSucceededButParseFailed} driveClientId=${!!driveClientId} driveConnected=${driveConnected} overrideUrl=${!!overrideUrl} resolvedId=${!!resolvedId} -> shouldAutoResolve=${shouldAutoResolve}`,
    );
    if (!shouldAutoResolve) return;
    const mimeType = gdocMimeType(ext);
    if (!mimeType) {
      console.warn(`[GDocViewer] no mimeType for ext=${ext}`);
      return;
    }
    // Strip the extension so the Drive query matches the doc title.
    const stem = basename.replace(/\.[^.]+$/, "");
    let cancelled = false;
    setAutoResolveStatus("searching");
    setAutoResolveError(null);
    console.info(`[GDocViewer] searching Drive for name="${stem}" mimeType=${mimeType}`);
    void (async () => {
      try {
        const files = await searchFiles(driveClientId, stem, mimeType);
        console.info(`[GDocViewer] Drive returned ${files.length} match(es)`, files);
        if (cancelled) return;
        if (files.length === 0) {
          setAutoResolveStatus("no-match");
          return;
        }
        if (files.length > 1) {
          setAutoMatches(files);
          setAutoResolveStatus("multi-match");
          return;
        }
        const winner = files[0]!;
        await updateMutation.mutateAsync({
          id: note.id,
          fields: { gdocResolvedId: winner.id },
        });
        if (cancelled) return;
        setAutoResolveStatus("done");
      } catch (err) {
        console.error(`[GDocViewer] Drive search failed`, err);
        if (cancelled) return;
        setAutoResolveError(err instanceof Error ? err.message : String(err));
        setAutoResolveStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoResolve, basename, ext, note.id]);

  const pickMatch = async (file: DriveFile) => {
    try {
      await updateMutation.mutateAsync({
        id: note.id,
        fields: { gdocResolvedId: file.id },
      });
      setAutoResolveStatus("done");
    } catch (err) {
      setAutoResolveError(err instanceof Error ? err.message : String(err));
      setAutoResolveStatus("error");
    }
  };

  const parsed = useMemo<{ docId: string; originalUrl: string } | null>(() => {
    // Cached resolved id (Drive auto-search) wins — fastest path on
    // every visit after the first one.
    if (resolvedId) {
      console.info(`[GDocViewer] using resolvedId=${resolvedId}`);
      return {
        docId: resolvedId,
        originalUrl: `https://docs.google.com/${docType}/d/${resolvedId}/edit`,
      };
    }
    // Override URL takes precedence — user-pasted URL when the .gdoc file
    // couldn't be read (cloud placeholder, permission glitch, …).
    if (overrideUrl) {
      const id = docIdFromUrl(overrideUrl);
      if (id) {
        console.info(`[GDocViewer] using overrideUrl docId=${id}`);
        return { docId: id, originalUrl: overrideUrl };
      }
    }
    if (!text) {
      console.info(`[GDocViewer] no text yet (loading?) path=${path}`);
      return null;
    }
    // Strip a UTF-8 BOM up front — some Drive clients (older Windows
    // versions) prepend one and `JSON.parse` chokes on it.
    const stripped = text.replace(/^﻿/, "").trim();
    console.info(
      `[GDocViewer] raw text path=${path} len=${text.length} stripped=${stripped.length} preview=${JSON.stringify(stripped.slice(0, 300))}`,
    );
    if (!stripped) return null;
    try {
      const pointer = JSON.parse(stripped) as GDocPointer;
      console.info(`[GDocViewer] parsed pointer`, pointer);
      const docId: string | null =
        pointer.doc_id ??
        (pointer.url ? docIdFromUrl(pointer.url) : null);
      if (!docId) {
        console.warn(`[GDocViewer] no doc_id extracted from pointer`, pointer);
        return null;
      }
      const originalUrl =
        pointer.url ??
        `https://docs.google.com/${docType}/d/${docId}/edit`;
      console.info(`[GDocViewer] resolved docId=${docId} originalUrl=${originalUrl}`);
      return { docId, originalUrl };
    } catch (err) {
      // Last-ditch: maybe the file is just a bare URL with no JSON wrapper.
      const id = docIdFromUrl(stripped);
      if (id) {
        console.info(`[GDocViewer] bare-URL fallback succeeded id=${id}`);
        return {
          docId: id,
          originalUrl: `https://docs.google.com/${docType}/d/${id}/edit`,
        };
      }
      console.warn(`[GDocViewer] JSON parse failed AND no URL found in body`, err);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, docType, path, overrideUrl, resolvedId]);

  // Iframe load detection — Google's `/preview` returns 200 even for
  // private docs (you just see a sign-in page inside the frame). To give
  // users a clear fallback, we ALSO watch for load timeout (no onLoad
  // fire within 6s = something is wrong — usually content-security/X-Frame).
  const [iframeStatus, setIframeStatus] = useState<"loading" | "ok" | "timeout">("loading");
  const iframeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!parsed) return;
    setIframeStatus("loading");
    if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
    iframeTimerRef.current = setTimeout(() => {
      setIframeStatus((s) => {
        if (s === "loading") {
          console.warn(`[GDocViewer] iframe load timeout after 6s — docId=${parsed.docId}`);
          return "timeout";
        }
        return s;
      });
    }, 6000);
    return () => {
      if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
    };
  }, [parsed]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  // Show the auto-resolve UI / paste prompt whenever we DON'T have a usable
  // docId yet — covers both the "read failed" path and the "read succeeded
  // but content is empty/garbage" path. `parsed` only exists when we've
  // managed to extract a docId from somewhere (cache, override, file
  // content, or a successful resolve).
  if (!parsed && !overrideUrl && !resolvedId) {
    // Drive auto-resolve in flight — show a richer loading state with what
    // we're doing, so the user knows we're not just stuck.
    if (autoResolveStatus === "searching") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-xs"
             style={{ color: "var(--text-muted)" }}>
          <Spinner size="md" />
          <span>Recherche du fichier dans Google Drive…</span>
          <span className="text-[10px]">{basename.replace(/\.[^.]+$/, "")}</span>
        </div>
      );
    }
    // Multiple Drive files match the name — let the user pick.
    if (autoResolveStatus === "multi-match") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-xs"
             style={{ color: "var(--text-muted)" }}>
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Plusieurs fichiers Drive correspondent à ce nom
          </span>
          <span className="text-[11px]">Sélectionne le bon :</span>
          <div className="flex w-full max-w-md flex-col gap-1">
            {autoMatches.map((file) => (
              <Button
                key={file.id}
                variant="ghost"
                size="sm"
                onPress={() => void pickMatch(file)}
                className="justify-start"
              >
                <span className="truncate">{file.name}</span>
                <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {file.id.slice(0, 12)}…
                </span>
              </Button>
            ))}
          </div>
        </div>
      );
    }
    // No Drive match (or error / Drive disabled) — fall through to the
    // paste-URL prompt. Show the auto-resolve error in the prompt if
    // there was one.
    return (
      <UrlOverridePrompt
        note={note}
        path={path}
        basename={basename}
        error={autoResolveError ?? error ?? "Le contenu du fichier ne contient pas d'URL Google reconnaissable."}
        docType={docType}
        autoResolveStatus={autoResolveStatus}
        driveConnected={driveConnected}
        onSave={async (url) => {
          await updateMutation.mutateAsync({
            id: note.id,
            fields: { gdocOverrideUrl: url },
          });
        }}
      />
    );
  }

  if (!parsed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs"
           style={{ color: "var(--text-muted)" }}>
        <span>Impossible de lire le fichier Google Workspace.</span>
        <span className="text-[10px]">
          Le fichier ne contient ni <code>doc_id</code> ni URL Google reconnaissable.
        </span>
        {text && (
          <code className="max-w-md break-all rounded px-2 py-1 text-[10px]"
                style={{ background: "var(--bg-subtle)" }}>
            {text.slice(0, 300)}
          </code>
        )}
      </div>
    );
  }

  const embedUrl = buildEmbedUrl(parsed.docId, docType);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
           style={{ borderColor: "var(--border)", background: "var(--bg-toolbar, var(--bg))" }}>
        <Chip size="sm" variant="soft" color="default" className="shrink-0">
          {TYPE_LABELS[docType]}
        </Chip>
        <span className="flex-1 truncate text-sm">{basename}</span>
        <Button
          size="sm"
          variant="ghost"
          onPress={() => window.open(parsed.originalUrl, "_blank", "noopener")}
        >
          Ouvrir dans Google
          <ArrowSquareOut size={14} />
        </Button>
      </div>

      {/* Embed area — preview iframe + fallback overlay if it never loads.
          We DON'T set `sandbox` here: Google's preview endpoint expects to
          read its own cookies (auth) to render private docs, and
          `allow-same-origin` removed inside a sandbox flips the iframe
          into a unique origin where the auth cookie is invisible. The
          embed URL itself is a Google-controlled trusted surface. */}
      <div className="relative min-h-0 flex-1">
        <iframe
          src={embedUrl}
          className="absolute inset-0 h-full w-full border-none"
          title={basename}
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => {
            console.info(`[GDocViewer] iframe onLoad — ${embedUrl}`);
            setIframeStatus("ok");
          }}
        />
        {iframeStatus === "loading" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center"
               style={{ background: "rgba(0,0,0,0.02)" }}>
            <Spinner size="sm" />
          </div>
        )}
        {iframeStatus === "timeout" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-xs"
               style={{ background: "var(--bg)", color: "var(--text-muted)" }}>
            <span>L&apos;aperçu Google n&apos;a pas pu se charger dans l&apos;app.</span>
            <span className="text-[10px]">
              Le document est probablement privé ou son embedding est restreint.
              Ouvre-le directement dans Google pour le voir.
            </span>
            <Button
              size="sm"
              variant="primary"
              onPress={() => window.open(parsed.originalUrl, "_blank", "noopener")}
            >
              Ouvrir dans Google
              <ArrowSquareOut size={14} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface UrlOverridePromptProps {
  note: AttachmentViewerProps["note"];
  path: string;
  basename: string;
  error: string;
  docType: GDocType;
  autoResolveStatus?: "idle" | "searching" | "no-match" | "multi-match" | "error" | "done";
  driveConnected?: boolean;
  onSave: (url: string) => Promise<void>;
}

/**
 * Fallback shown when the on-disk `.gdoc`/`.gsheet` file is unreadable
 * (typically a Google Drive cloud placeholder). Lets the user paste the
 * canonical Google URL directly — we save it on the entity via
 * `fields.gdocOverrideUrl` so the iframe loads on this and every
 * subsequent visit, no FSA read required.
 */
function UrlOverridePrompt({
  path: _path,
  basename,
  error,
  docType,
  autoResolveStatus,
  driveConnected,
  onSave,
}: UrlOverridePromptProps) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const looksLikeCloudIssue = /illisible|cloud|NotReadableError|placeholder/i.test(error);
  const trimmed = draft.trim();
  const valid = /\/d\/[a-zA-Z0-9_-]{8,}/.test(trimmed) || /[?&]id=[a-zA-Z0-9_-]{8,}/.test(trimmed);

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await onSave(trimmed);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const typeLabel = TYPE_LABELS[docType];

  const headline =
    autoResolveStatus === "no-match"
      ? "Aucun fichier Drive ne correspond à ce nom"
      : looksLikeCloudIssue
        ? "Fichier Google Drive non disponible localement"
        : `Impossible de lire ${basename}`;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center text-xs"
         style={{ color: "var(--text-muted)" }}>
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {headline}
        </span>
        <span className="max-w-md text-[11px]">{error}</span>
        {!driveConnected && (
          <span className="mt-1 max-w-md text-[10px]">
            Astuce : configure Google Drive dans <em>Paramètres → Google Drive</em>{" "}
            pour résoudre automatiquement les .gdoc/.gsheet sans coller d&apos;URL.
          </span>
        )}
      </div>

      <div className="flex w-full max-w-md flex-col gap-2 rounded border p-3 text-left"
           style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}>
        <span className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>
          Colle l&apos;URL {typeLabel} pour l&apos;afficher quand même :
        </span>
        <div className="flex gap-2">
          <Input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://docs.google.com/…/d/…"
            disabled={saving}
          />
          <Button
            variant="primary"
            isDisabled={!valid || saving}
            onPress={submit}
          >
            {saving ? <Spinner size="sm" /> : "Embed"}
          </Button>
        </div>
        {saveErr && (
          <span className="text-[11px]" style={{ color: "var(--color-danger, #ef4444)" }}>
            Erreur : {saveErr}
          </span>
        )}
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          L&apos;URL est sauvegardée sur la note ; tu n&apos;auras pas besoin de la recoller.
        </span>
      </div>

      {looksLikeCloudIssue && (
        <details className="max-w-md text-left">
          <summary className="cursor-pointer text-[11px] underline-offset-2 hover:underline">
            Ou rends le fichier disponible hors ligne dans Google Drive
          </summary>
          <ol className="mt-2 list-decimal pl-4 text-[11px] leading-relaxed">
            <li>Ouvre Google Drive sur ton bureau.</li>
            <li>Clique-droit sur <code>{basename}</code>.</li>
            <li>Choisis &laquo; Disponible hors ligne &raquo;.</li>
            <li>Rafraîchis cette page.</li>
          </ol>
        </details>
      )}
    </div>
  );
}
