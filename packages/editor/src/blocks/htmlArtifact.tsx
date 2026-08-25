// Bloc HTML — artefact autonome (page Claude, maquette, mini-app) rendu dans
// la note.
//
// Le contenu est rendu dans une iframe `srcDoc` **sandbox sans
// allow-same-origin** : l'artefact s'exécute dans une origine opaque, il ne
// peut donc lire ni le coffre, ni le localStorage, ni les cookies de l'app.
// Contrepartie assumée : un artefact qui appelle localStorage/IndexedDB lève
// une exception chez lui — c'est le prix de l'isolation, ne pas ajouter
// allow-same-origin pour « réparer » ça (ça rendrait le HTML collé capable de
// piloter Supernote).
//
// Self-contained (pas de renderer délégué) : le bloc édite ses propres props.

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  clampHtmlHeight,
  HTML_ARTIFACT_DEFAULT_HEIGHT,
  HTML_ARTIFACT_MIN_HEIGHT,
} from "./htmlArtifactUtils.js";

const HTML_ACCENT = "#e34c26"; // orange HTML5, aligné sur le vert Sheets du bloc voisin
const DEFAULT_HEIGHT = HTML_ARTIFACT_DEFAULT_HEIGHT;
const MIN_HEIGHT = HTML_ARTIFACT_MIN_HEIGHT;

const cardStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--border-subtle)",
  borderLeft: `3px solid ${HTML_ACCENT}`,
  background: "var(--surface-1)",
  overflow: "hidden",
};

const barButtonStyle: React.CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--text-muted)",
  font: "inherit",
  fontSize: 12,
  lineHeight: 1,
  padding: "8px 10px",
  minHeight: 32,
  borderRadius: 6,
  cursor: "pointer",
};

function barButtonActiveStyle(active: boolean): React.CSSProperties {
  return active
    ? {
        ...barButtonStyle,
        color: "var(--text-primary)",
        background: "color-mix(in srgb, var(--surface-2) 90%, transparent)",
        fontWeight: 600,
      }
    : barButtonStyle;
}

function HtmlIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 3,
        background: HTML_ACCENT,
        color: "#fff",
        fontSize: size * 0.5,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {"<>"}
    </span>
  );
}

/** Iframe isolée. `key` sur le html pour forcer un remount à chaque édition. */
function HtmlFrame({
  html,
  height,
  title,
}: {
  html: string;
  height: number | string;
  title: string;
}): React.JSX.Element {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
      referrerPolicy="no-referrer"
      style={{ display: "block", width: "100%", height, border: "none", background: "#fff" }}
    />
  );
}

// ── Plein écran ──────────────────────────────────────────────────────────────

function FullscreenOverlay({
  html,
  onClose,
}: {
  html: string;
  onClose: () => void;
}): React.JSX.Element {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: 12,
        }}
      >
        <HtmlIcon />
        <span style={{ color: "var(--text-muted)" }}>Artefact HTML</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Quitter le plein écran"
          style={{ ...barButtonStyle, marginLeft: "auto" }}
        >
          Fermer ✕
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <HtmlFrame html={html} height="100%" title="Artefact HTML plein écran" />
      </div>
    </div>
  );
}

// ── État vide ────────────────────────────────────────────────────────────────

function EmptyState({ onSubmit }: { onSubmit: (html: string) => void }): React.JSX.Element {
  const [value, setValue] = React.useState("");
  return (
    <div style={{ ...cardStyle, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 8 }}>
        <HtmlIcon />
        <span style={{ color: "var(--text-muted)" }}>
          Colle ton artefact HTML (Ctrl+V), il sera rendu ici.
        </span>
      </div>
      {/* textarea nu : éditeur de code (cf. exceptions HeroUI documentées) */}
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text/plain");
          if (!text.trim()) return;
          e.preventDefault();
          onSubmit(text);
        }}
        placeholder="<!DOCTYPE html> …"
        spellCheck={false}
        rows={4}
        style={{
          width: "100%",
          resize: "vertical",
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          background: "var(--surface-2)",
          color: "var(--text-primary)",
          padding: 8,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: 12,
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button
          type="button"
          onClick={() => value.trim() && onSubmit(value)}
          style={{
            ...barButtonStyle,
            color: "#fff",
            background: HTML_ACCENT,
            fontWeight: 600,
            padding: "8px 14px",
          }}
        >
          Afficher
        </button>
      </div>
    </div>
  );
}

// ── Bloc rempli ──────────────────────────────────────────────────────────────

function HtmlArtifact({
  html,
  height,
  onChangeHtml,
  onChangeHeight,
}: {
  html: string;
  height: number;
  onChangeHtml: (next: string) => void;
  onChangeHeight: (next: number) => void;
}): React.JSX.Element {
  const [mode, setMode] = React.useState<"preview" | "code">("preview");
  const [fullscreen, setFullscreen] = React.useState(false);
  const [draft, setDraft] = React.useState(html);
  React.useEffect(() => setDraft(html), [html]);

  // Redimensionnement vertical : la hauteur est persistée dans les props du
  // bloc (donc dans le markdown), sinon chaque reload rendrait l'artefact dans
  // une fenêtre de 420px quel que soit son contenu.
  const dragRef = React.useRef<{ startY: number; startH: number } | null>(null);
  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      onChangeHeight(clampHtmlHeight(drag.startH + (e.clientY - drag.startY)));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onChangeHeight]);

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 6px 2px 10px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "color-mix(in srgb, var(--surface-2) 60%, transparent)",
          fontSize: 12,
        }}
      >
        <HtmlIcon />
        <span style={{ color: "var(--text-muted)", marginRight: 4 }}>Artefact HTML</span>
        <button
          type="button"
          onClick={() => setMode("preview")}
          style={barButtonActiveStyle(mode === "preview")}
        >
          Aperçu
        </button>
        <button
          type="button"
          onClick={() => setMode("code")}
          style={barButtonActiveStyle(mode === "code")}
        >
          Code
        </button>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="Ouvrir en plein écran"
          style={{ ...barButtonStyle, marginLeft: "auto" }}
        >
          Plein écran ⛶
        </button>
      </div>

      {mode === "preview" ? (
        <>
          <HtmlFrame key={html} html={html} height={height} title="Artefact HTML" />
          <div
            onPointerDown={(e) => {
              e.preventDefault();
              dragRef.current = { startY: e.clientY, startH: height };
            }}
            role="separator"
            aria-label="Redimensionner l'aperçu"
            style={{
              height: 10,
              cursor: "ns-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "color-mix(in srgb, var(--surface-2) 60%, transparent)",
              touchAction: "none",
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 32, height: 3, borderRadius: 2, background: "var(--border-subtle)" }}
            />
          </div>
        </>
      ) : (
        <div style={{ padding: 8 }}>
          {/* textarea nu : éditeur de code (cf. exceptions HeroUI documentées) */}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft !== html && onChangeHtml(draft)}
            spellCheck={false}
            style={{
              width: "100%",
              height: Math.max(MIN_HEIGHT, Math.min(height, 600)),
              resize: "vertical",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              background: "var(--surface-2)",
              color: "var(--text-primary)",
              padding: 8,
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 6,
            }}
          >
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
              {draft.length.toLocaleString("fr-FR")} caractères
            </span>
            <button
              type="button"
              onClick={() => onChangeHtml(draft)}
              style={{ ...barButtonStyle, color: "var(--text-primary)", fontWeight: 600 }}
            >
              Appliquer
            </button>
          </div>
        </div>
      )}

      {fullscreen && <FullscreenOverlay html={html} onClose={() => setFullscreen(false)} />}
    </div>
  );
}

// ── Block spec ───────────────────────────────────────────────────────────────

// props `html` / `height` : NE PAS renommer — la sérialisation markdown
// (```html preview h=…, cf. serialization/serialize.ts et parse.ts) en dépend.
export const htmlArtifactBlockSpec = createReactBlockSpec(
  {
    type: "htmlArtifact" as const,
    propSchema: {
      html: { default: "" },
      height: { default: DEFAULT_HEIGHT },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const html = (block.props.html ?? "") as string;
      const height = clampHtmlHeight(block.props.height);

      const setProps = (props: { html?: string; height?: number }) => {
        editor.updateBlock(block.id, { props } as never);
      };

      return (
        <div className="sn-html-artifact" contentEditable={false}>
          {html.trim() ? (
            <HtmlArtifact
              html={html}
              height={height}
              onChangeHtml={(next) => setProps({ html: next })}
              onChangeHeight={(next) => setProps({ height: next })}
            />
          ) : (
            <EmptyState onSubmit={(next) => setProps({ html: next })} />
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => {
      // Copie hors éditeur : on rend le code, pas l'artefact exécuté.
      const html = (block.props.html ?? "") as string;
      return (
        <pre>
          <code>{html}</code>
        </pre>
      );
    },
  },
);
