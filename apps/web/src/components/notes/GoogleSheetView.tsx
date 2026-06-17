"use client";

/**
 * GoogleSheetView — renderer du bloc `googleSheet` (délégué par l'éditeur via
 * GoogleSheetProvider).
 *
 * Décide l'affichage :
 *   - connecté à Google + feuille « normale » (/d/<id>) → lit les valeurs via
 *     l'API Sheets (scope spreadsheets.readonly) et rend une table. La feuille
 *     reste PRIVÉE — pas besoin de la publier.
 *   - sinon (non connecté, ou URL « publiée » /d/e/<id>, ou erreur API) →
 *     fallback iframe pubhtml (desktop) / lien (mobile), comportement du bloc.
 *
 * Sans renderer du tout (éditeur imbriqué du portail), le bloc gère lui-même
 * l'iframe ; ce composant n'est branché que sur l'éditeur de note principal.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import { ArrowsClockwise, ArrowSquareOut, Warning } from "@phosphor-icons/react";
import { buildPubhtmlUrl, buildOpenUrl } from "@supernote/editor";
import { useSettings } from "../settings/SettingsContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { fetchSheetData, type SheetData } from "@/lib/google-drive";

const SHEET_GREEN = "#188038";
const TABLE_MAX_HEIGHT = 420;

interface Props {
  spreadsheetId: string;
  gid: string;
  url: string;
  onClear: () => void;
}

export function renderGoogleSheet(props: {
  spreadsheetId: string;
  gid: string;
  url: string;
  onClear: () => void;
}): React.ReactNode {
  return <GoogleSheetView {...props} />;
}

const cardStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid var(--border-subtle)",
  borderLeft: `3px solid ${SHEET_GREEN}`,
  background: "var(--surface-1)",
  overflow: "hidden",
};

function SheetIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
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

function GoogleSheetView({ spreadsheetId, gid, url, onClear }: Props): React.JSX.Element {
  const { settings } = useSettings();
  const isMobile = useIsMobile();
  const clientId = settings.googleDrive?.clientId?.trim() ?? "";
  const isConnected = !!settings.googleDrive?.connectedEmail;
  // La forme publiée /d/e/<id> n'a pas d'id de classeur exploitable par l'API.
  const isPublishedForm = spreadsheetId.startsWith("e/");
  const canApiRead = isConnected && !!clientId && !isPublishedForm;

  const ref = { spreadsheetId, gid };
  const openUrl = buildOpenUrl(ref);

  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canApiRead) return;
    setLoading(true);
    setError(null);
    fetchSheetData(clientId, spreadsheetId, gid)
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [canApiRead, clientId, spreadsheetId, gid]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Fallback : pas de lecture API possible → iframe (desktop) / lien (mobile) ──
  if (!canApiRead || error) {
    if (isMobile) {
      return (
        <div style={{ ...cardStyle, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <SheetIcon size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>Google Sheet</div>
            <button
              type="button"
              onClick={onClear}
              style={{ padding: 0, border: "none", background: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}
            >
              changer le lien
            </button>
          </div>
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: "10px 14px", borderRadius: 8, background: SHEET_GREEN, color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Ouvrir ↗
          </a>
        </div>
      );
    }
    return (
      <div style={cardStyle}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontSize: 12 }}>
            <Warning size={14} style={{ color: "var(--color-danger, #ef4444)", flexShrink: 0 }} />
            <span style={{ flex: 1 }}>Lecture privée impossible — vue publiée affichée. {error.slice(0, 120)}</span>
            <button type="button" onClick={load} style={{ border: "none", background: "none", color: SHEET_GREEN, fontSize: 12, cursor: "pointer" }}>réessayer</button>
          </div>
        )}
        <iframe
          src={buildPubhtmlUrl(ref)}
          title="Google Sheet"
          loading="lazy"
          style={{ display: "block", width: "100%", height: TABLE_MAX_HEIGHT, border: "none" }}
        />
        <div style={footerStyle}>
          <SheetIcon />
          <span style={{ color: "var(--text-muted)" }}>
            {isConnected || isPublishedForm
              ? "Google Sheet — vue lecture seule"
              : "Connecte Google (Réglages › Google Drive) pour lire tes feuilles privées"}
          </span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 12 }}>
            <button type="button" onClick={onClear} style={linkBtnStyle}>changer</button>
            <a href={openUrl} target="_blank" rel="noopener noreferrer" style={{ color: SHEET_GREEN, fontWeight: 600, textDecoration: "none" }}>ouvrir dans Google ↗</a>
          </span>
        </div>
      </div>
    );
  }

  // ── Mobile connecté : la table est trop large → on garde le lien ──────────────
  if (isMobile) {
    return (
      <div style={{ ...cardStyle, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <SheetIcon size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>
            {data?.spreadsheetTitle ?? "Google Sheet"}
          </div>
          <button type="button" onClick={onClear} style={{ padding: 0, border: "none", background: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}>changer le lien</button>
        </div>
        <a href={openUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "10px 14px", borderRadius: 8, background: SHEET_GREEN, color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>Ouvrir ↗</a>
      </div>
    );
  }

  // ── Desktop connecté : table lue via l'API (feuille privée) ───────────────────
  const rows = data?.rows ?? [];
  const header = rows[0] ?? [];
  const bodyRows = rows.slice(1);
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);

  return (
    <div style={cardStyle}>
      <div style={{ ...footerStyle, borderBottom: "1px solid var(--border-subtle)", borderTop: "none" }}>
        <SheetIcon />
        <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
          {data?.spreadsheetTitle ?? "Google Sheet"}
        </span>
        {data?.sheetTitle && <span style={{ color: "var(--text-muted)" }}>· {data.sheetTitle}</span>}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12 }}>
          {loading && <Spinner size="sm" aria-label="Chargement" />}
          <Button variant="ghost" size="sm" onPress={load} isDisabled={loading} aria-label="Rafraîchir">
            <ArrowsClockwise size={14} />
          </Button>
          <button type="button" onClick={onClear} style={linkBtnStyle}>changer</button>
          <a href={openUrl} target="_blank" rel="noopener noreferrer" style={{ color: SHEET_GREEN, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ArrowSquareOut size={13} /> ouvrir
          </a>
        </span>
      </div>
      {/* Grille NxM dynamique en lecture seule → <table> nu justifié (HeroUI
          Table v3 mal adapté à des colonnes entièrement dynamiques). */}
      <div style={{ maxHeight: TABLE_MAX_HEIGHT, overflow: "auto" }}>
        {rows.length === 0 ? (
          <p style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>
            {loading ? "Chargement…" : "Feuille vide."}
          </p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                {Array.from({ length: colCount }, (_, c) => (
                  <th
                    key={c}
                    style={{
                      position: "sticky",
                      top: 0,
                      textAlign: "left",
                      padding: "6px 10px",
                      background: "var(--surface-2)",
                      color: "var(--text-secondary)",
                      fontWeight: 600,
                      borderBottom: "1px solid var(--border-subtle)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {header[c] ?? ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, r) => (
                <tr key={r}>
                  {Array.from({ length: colCount }, (_, c) => (
                    <td
                      key={c}
                      style={{
                        padding: "6px 10px",
                        borderBottom: "1px solid var(--border-subtle)",
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        maxWidth: 280,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row[c] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderTop: "1px solid var(--border-subtle)",
  background: "color-mix(in srgb, var(--surface-2) 60%, transparent)",
  fontSize: 12,
};

const linkBtnStyle: React.CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--text-muted)",
  fontSize: 12,
  cursor: "pointer",
};
