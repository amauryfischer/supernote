"use client";

/**
 * Vue « mode HTML » d'une note : l'artefact occupe tout le cadre d'édition, à
 * la place de l'éditeur markdown.
 *
 * Le corps de la note reste du markdown (bloc ```html preview) — cf.
 * `lib/html-note.ts`. Cette vue n'édite que la tranche de l'artefact, donc
 * repasser en markdown ne perd rien.
 *
 * L'iframe est sandboxée SANS allow-same-origin : origine opaque, l'artefact ne
 * peut pas lire le coffre ni le stockage de l'app. Un artefact qui appelle
 * localStorage lèvera chez lui — ne pas « réparer » ça en ouvrant le sandbox.
 */

import { useCallback, useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { ArrowsClockwise, Code, Eye } from "@phosphor-icons/react";
import { Tooltip } from "@supernote/ui";
import { findHtmlArtifact, initialHtmlFor, writeHtmlArtifact } from "@/lib/html-note";

interface HtmlNoteViewProps {
  /** Corps markdown courant de la note. */
  body: string;
  /** Reçoit le corps markdown réécrit (déclenche l'autosave de la note). */
  onChange: (body: string) => void;
}

export function HtmlNoteView({ body, onChange }: HtmlNoteViewProps) {
  const [mode, setMode] = useState<"preview" | "code">(() =>
    initialHtmlFor(body).trim() ? "preview" : "code",
  );
  const [html, setHtml] = useState(() => initialHtmlFor(body));
  // Remonte l'iframe à la demande (un artefact avec du JS d'init veut parfois
  // repartir de zéro) et à chaque application de code.
  const [frameKey, setFrameKey] = useState(0);

  // Hauteur mémorisée du bloc : la vue est plein cadre, mais on la préserve
  // pour que le bloc retrouve sa taille si la note repasse en markdown.
  const height = useMemo(() => findHtmlArtifact(body)?.height, [body]);

  const apply = useCallback(
    (next: string) => {
      setHtml(next);
      onChange(writeHtmlArtifact(body, next, height));
    },
    [body, height, onChange],
  );

  const hasContent = html.trim().length > 0;

  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      <div
        className="flex flex-wrap items-center gap-1 px-4 pb-2 md:px-10"
        style={{ color: "var(--text-muted)" }}
      >
        <Button
          variant={mode === "preview" ? "secondary" : "ghost"}
          size="sm"
          onPress={() => {
            setMode("preview");
            setFrameKey((k) => k + 1);
          }}
          isDisabled={!hasContent}
          className="sn-hit h-8 min-w-0 gap-1 px-3 text-xs"
          aria-pressed={mode === "preview"}
          aria-label="Aperçu de l'artefact"
        >
          <Eye size={14} />
          Aperçu
        </Button>
        <Button
          variant={mode === "code" ? "secondary" : "ghost"}
          size="sm"
          onPress={() => setMode("code")}
          className="sn-hit h-8 min-w-0 gap-1 px-3 text-xs"
          aria-pressed={mode === "code"}
          aria-label="Code HTML"
        >
          <Code size={14} />
          Code
        </Button>
        {mode === "preview" && hasContent && (
          <Tooltip content="Relancer l'artefact">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setFrameKey((k) => k + 1)}
              className="sn-hit h-8 min-w-0 px-2 text-xs"
              aria-label="Relancer l'artefact"
            >
              <ArrowsClockwise size={14} />
            </Button>
          </Tooltip>
        )}
        <span className="ml-auto text-[11px]">
          {hasContent
            ? `${html.length.toLocaleString("fr-FR")} caractères · exécuté en bac à sable`
            : "Colle ton artefact HTML dans l'onglet Code"}
        </span>
      </div>

      <div
        className="mx-4 mb-4 flex-1 overflow-hidden rounded-xl md:mx-10"
        style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
      >
        {mode === "preview" && hasContent ? (
          <iframe
            key={frameKey}
            title="Artefact HTML"
            srcDoc={html}
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
            referrerPolicy="no-referrer"
            className="block h-full w-full"
            style={{ border: "none", background: "#fff", minHeight: "60vh" }}
          />
        ) : (
          /* textarea nu : éditeur de code (exception assumée à HeroUI, comme le
             Cell editor) */
          <textarea
            value={html}
            onChange={(e) => apply(e.target.value)}
            spellCheck={false}
            placeholder="<!DOCTYPE html> …"
            className="block h-full w-full resize-none p-4 font-mono text-xs outline-none"
            style={{
              background: "transparent",
              color: "var(--text-primary)",
              minHeight: "60vh",
              whiteSpace: "pre",
            }}
          />
        )}
      </div>
    </div>
  );
}
