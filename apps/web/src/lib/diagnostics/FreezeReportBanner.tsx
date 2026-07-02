/**
 * Affiche à l'écran le rapport du watchdog anti-freeze (voir freeze-watchdog.ts)
 * quand la session PRÉCÉDENTE semble avoir gelé. La console étant inaccessible
 * sur téléphone, c'est le seul moyen pour l'utilisateur de récupérer l'indice
 * (dernière activité + stalls) et de nous le copier.
 *
 * Monté dans RootLayout → vit sous le routeur, donc `useLocation` sert aussi à
 * déposer un breadcrumb « route:… » à chaque navigation (hotspot de montage).
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@heroui/react";
import {
  breadcrumb,
  clearFreezeReport,
  getFreezeReport,
  type FreezeReport,
} from "./freeze-watchdog";

function formatReport(r: FreezeReport): string {
  const lines: string[] = [];
  lines.push(`unclean=${r.unclean}`);
  if (r.crumb) {
    const when = new Date(r.crumb.t).toLocaleString();
    lines.push(`dernière activité: "${r.crumb.label}" @ ${when}`);
  } else {
    lines.push("dernière activité: (aucune)");
  }
  if (r.lastAlive) {
    lines.push(`dernier battement: ${new Date(r.lastAlive).toLocaleString()}`);
    // Écart crumb→dernier battement = borne basse de la durée du gel.
    if (r.crumb && r.lastAlive >= r.crumb.t) {
      lines.push(`gel ≳ ${Math.round((r.lastAlive - r.crumb.t) / 1000)}s après la dernière activité`);
    }
  }
  if (r.longTasks.length > 0) {
    lines.push(
      `stalls: ${r.longTasks
        .map((lt) => (lt.src ? `${lt.dur}ms (${lt.src})` : `${lt.dur}ms`))
        .join(", ")}`,
    );
  }
  if (r.errors.length > 0) {
    lines.push("erreurs:");
    for (const e of r.errors) {
      lines.push(`  [${e.source}] ${e.message}`);
    }
  }
  lines.push(`ua: ${navigator.userAgent}`);
  return lines.join("\n");
}

export function FreezeReportBanner() {
  const location = useLocation();
  const [report, setReport] = useState<FreezeReport | null>(() => getFreezeReport());
  const [copied, setCopied] = useState(false);

  // Breadcrumb à chaque navigation — `breadcrumb` ne touche localStorage que si
  // le label change, donc c'est gratuit sur les re-renders identiques.
  useEffect(() => {
    breadcrumb(`route:${location.pathname}`);
  }, [location.pathname]);

  if (!report) return null;

  const text = formatReport(report);

  const onCopy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard refusé — le <pre> reste sélectionnable manuellement */
      });
  };

  const onDismiss = () => {
    clearFreezeReport();
    setReport(null);
  };

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 9999,
        maxWidth: 520,
        margin: "0 auto",
        padding: 14,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--surface-0)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        ⚠️ La session précédente s'est figée
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        Indice capturé par le watchdog. Copie-le et envoie-le pour localiser le
        freeze.
      </div>
      <pre
        style={{
          margin: 0,
          marginBottom: 10,
          padding: 8,
          fontSize: 11,
          lineHeight: 1.4,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          borderRadius: 8,
          background: "var(--surface-1, rgba(0,0,0,0.04))",
          userSelect: "text",
        }}
      >
        {text}
      </pre>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button size="sm" variant="ghost" onPress={onDismiss}>
          Ignorer
        </Button>
        <Button size="sm" variant="primary" onPress={onCopy}>
          {copied ? "Copié ✓" : "Copier"}
        </Button>
      </div>
    </div>
  );
}
