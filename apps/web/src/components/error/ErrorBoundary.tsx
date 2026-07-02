"use client";

/**
 * Filet anti-écran-blanc. Avant, une exception dans le rendu React laissait un
 * écran vide sans trace ; aucune erreur n'était capturée pour le diagnostic
 * (le dossier « freeze mobile »). Deux boundaries se complètent :
 *
 *  - `RouteErrorBoundary` (function, `useRouteError`) : posé sur la route racine
 *    du data-router → attrape les erreurs de RootLayout et de toutes les pages.
 *  - `AppErrorBoundary` (class, `componentDidCatch`) : enveloppe `RouterProvider`
 *    → filet pour ce qui est HORS de l'arbre de routes.
 *
 * Les deux enregistrent l'erreur via `recordError` (anneau localStorage du
 * watchdog) et rendent un fallback en HTML nu + styles inline, pour s'afficher
 * même si les providers HeroUI/thème sont eux-mêmes tombés.
 */

import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { recordError } from "@/lib/diagnostics/freeze-watchdog";

function reload(): void {
  try {
    window.location.reload();
  } catch {
    /* environnement sans window — best-effort */
  }
}

function ErrorFallback({ title, detail }: { title: string; detail: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard
      ?.writeText(detail)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard refusé — le <pre> reste sélectionnable */
      });
  };
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        textAlign: "center",
        background: "var(--surface-0, #fff)",
        color: "var(--text-primary, #111)",
      }}
    >
      <div style={{ fontSize: 32 }}>⚠️</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 13, maxWidth: 420, color: "var(--text-muted, #666)" }}>
        L'application a rencontré une erreur inattendue. Recharger résout le
        problème la plupart du temps. Si ça se reproduit, copie le détail.
      </div>
      <pre
        style={{
          margin: 0,
          maxWidth: 520,
          maxHeight: 200,
          overflow: "auto",
          padding: 10,
          fontSize: 11,
          lineHeight: 1.4,
          textAlign: "left",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          borderRadius: 8,
          background: "var(--surface-1, rgba(0,0,0,0.05))",
          userSelect: "text",
        }}
      >
        {detail}
      </pre>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onCopy}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: "1px solid var(--border, #ccc)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {copied ? "Copié ✓" : "Copier le détail"}
        </button>
        <button
          type="button"
          onClick={reload}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: "none",
            background: "var(--accent, #6d28d9)",
            color: "var(--accent-foreground, #fff)",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Recharger
        </button>
      </div>
    </div>
  );
}

/** Détail lisible (message + début de stack) pour le fallback et le clipboard. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return [error.message, error.stack?.split("\n").slice(0, 6).join("\n")]
      .filter(Boolean)
      .join("\n");
  }
  return String(error);
}

/** Boundary de route (data-router) — attrape RootLayout + toutes les pages. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const isRouteResponse = isRouteErrorResponse(error);
  const detail = isRouteResponse
    ? `${error.status} ${error.statusText}`
    : describe(error);

  useEffect(() => {
    // Les 404/redirections routeur ne sont pas des bugs à télémétrer.
    if (isRouteResponse) return;
    recordError(
      "react",
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
    );
  }, [error, isRouteResponse]);

  return (
    <ErrorFallback
      title={isRouteResponse ? "Page introuvable" : "Une erreur s'est produite"}
      detail={detail}
    />
  );
}

interface AppErrorBoundaryProps {
  children: ReactNode;
}
interface AppErrorBoundaryState {
  error: Error | null;
}

/** Filet class autour de RouterProvider (erreurs hors arbre de routes). */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    recordError(
      "react",
      error.message,
      [error.stack, info.componentStack].filter(Boolean).join("\n"),
    );
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <ErrorFallback title="Une erreur s'est produite" detail={describe(this.state.error)} />;
    }
    return this.props.children;
  }
}
