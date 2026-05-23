"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, Input, Spinner } from "@heroui/react";
import { ArrowSquareOut } from "@phosphor-icons/react";

import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";
import { trpc } from "@/lib/trpc/client";

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

function buildEmbedUrl(docId: string, type: GDocType): string {
  return `https://docs.google.com/${type}/d/${docId}/preview`;
}

export function GDocViewer({ note, path }: AttachmentViewerProps) {
  const { loading, error, text } = useAttachmentBlob(path);
  const updateMutation = trpc.entities.update.useMutation();

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

  const parsed = useMemo<{ docId: string; originalUrl: string } | null>(() => {
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
  }, [text, docType, path, overrideUrl]);

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

  if (error && !overrideUrl) {
    return (
      <UrlOverridePrompt
        note={note}
        path={path}
        basename={basename}
        error={error}
        docType={docType}
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

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center text-xs"
         style={{ color: "var(--text-muted)" }}>
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {looksLikeCloudIssue
            ? "Fichier Google Drive non disponible localement"
            : `Impossible de lire ${basename}`}
        </span>
        <span className="max-w-md text-[11px]">{error}</span>
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
