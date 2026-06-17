// Bloc Google Sheet — embed lecture-seule.
//
// Desktop : iframe de la vue « Publier sur le web » (l'éditeur Google n'est pas
// iframable — X-Frame-Options: SAMEORIGIN ; seule /pubhtml l'est, en lecture
// seule). Mobile : carte + bouton « Ouvrir dans Google Sheets » (l'iframe
// Google n'est pas responsive sur téléphone).
//
// Self-contained (pas de renderer délégué) : le bloc édite sa propre prop `url`
// via editor.updateBlock. Bloc contentEditable=false (comme embed/databaseView).

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  parseGoogleSheetUrl,
  buildPubhtmlUrl,
  buildOpenUrl,
} from "./googleSheetUrl.js";

const SHEET_GREEN = "#188038";
const IFRAME_HEIGHT = 420;

/** Vrai sous 768px (aligné sur le breakpoint mobile de l'app, `md:` Tailwind). */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

function SheetIcon({ size = 16 }: { size?: number }): React.JSX.Element {
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
        background: SHEET_GREEN,
        color: "#fff",
        fontSize: size * 0.62,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      ▦
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--border-subtle)",
  borderLeft: `3px solid ${SHEET_GREEN}`,
  background: "var(--surface-1)",
  overflow: "hidden",
};

// ── État vide : saisie de l'URL ──────────────────────────────────────────────

function EmptyState({
  onSubmit,
}: {
  onSubmit: (url: string) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState(false);

  const submit = () => {
    const ref = parseGoogleSheetUrl(value);
    if (!ref) {
      setError(true);
      return;
    }
    onSubmit(value.trim());
  };

  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <SheetIcon />
        <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>
          Google Sheet
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="url"
          value={value}
          autoFocus
          placeholder="Coller l'URL d'une feuille Google publiée sur le web"
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          style={{
            flex: "1 1 260px",
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${error ? "var(--destructive, #e5484d)" : "var(--border-subtle)"}`,
            background: "var(--surface-0)",
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={submit}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "none",
            background: SHEET_GREEN,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Intégrer
        </button>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
        {error
          ? "URL Google Sheets non reconnue."
          : "Dans Google Sheets : Fichier › Partager › Publier sur le web. La feuille sera visible par toute personne ayant le lien."}
      </p>
    </div>
  );
}

// ── Carte mobile : titre + bouton d'ouverture ────────────────────────────────

function MobileCard({
  openUrl,
  onChange,
}: {
  openUrl: string;
  onChange: () => void;
}): React.JSX.Element {
  return (
    <div style={{ ...cardStyle, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
      <SheetIcon size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>
          Google Sheet
        </div>
        <button
          type="button"
          onClick={onChange}
          style={{
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--text-muted)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          changer le lien
        </button>
      </div>
      <a
        href={openUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: SHEET_GREEN,
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Ouvrir ↗
      </a>
    </div>
  );
}

// ── Embed desktop : iframe + footer ──────────────────────────────────────────

function DesktopEmbed({
  embedUrl,
  openUrl,
  onChange,
}: {
  embedUrl: string;
  openUrl: string;
  onChange: () => void;
}): React.JSX.Element {
  return (
    <div style={cardStyle}>
      <iframe
        src={embedUrl}
        title="Google Sheet"
        loading="lazy"
        style={{ display: "block", width: "100%", height: IFRAME_HEIGHT, border: "none" }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderTop: "1px solid var(--border-subtle)",
          background: "color-mix(in srgb, var(--surface-2) 60%, transparent)",
          fontSize: 12,
        }}
      >
        <SheetIcon />
        <span style={{ color: "var(--text-muted)" }}>Google Sheet — vue lecture seule</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 12 }}>
          <button
            type="button"
            onClick={onChange}
            style={{ border: "none", background: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}
          >
            changer
          </button>
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: SHEET_GREEN, fontWeight: 600, textDecoration: "none" }}
          >
            ouvrir dans Google ↗
          </a>
        </span>
      </div>
    </div>
  );
}

// ── Block spec ───────────────────────────────────────────────────────────────

// prop `url` : NE PAS renommer — la sérialisation markdown `[googleSheet url="…"]`
// (serialization/serialize.ts, parse.ts) en dépend.
export const googleSheetBlockSpec = createReactBlockSpec(
  {
    type: "googleSheet" as const,
    propSchema: {
      url: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const url = (block.props.url ?? "") as string;
      const isNarrow = useIsNarrow();

      const setUrl = (next: string) => {
        editor.updateBlock(block, { props: { url: next } } as never);
      };
      const clear = () => setUrl("");

      const ref = url ? parseGoogleSheetUrl(url) : null;

      return (
        <div className="sn-googlesheet" contentEditable={false}>
          {!ref ? (
            <EmptyState onSubmit={setUrl} />
          ) : isNarrow ? (
            <MobileCard openUrl={buildOpenUrl(ref)} onChange={clear} />
          ) : (
            <DesktopEmbed
              embedUrl={buildPubhtmlUrl(ref)}
              openUrl={buildOpenUrl(ref)}
              onChange={clear}
            />
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => {
      // Export markdown/HTML : on garde la directive round-trippable.
      const url = (block.props.url ?? "") as string;
      return <p>{`[googleSheet url="${url}"]`}</p>;
    },
  },
);
