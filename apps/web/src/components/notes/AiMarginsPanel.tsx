"use client";

/**
 * AiMarginsPanel — marges IA ambiantes. Colonne discrète à droite de
 * l'éditeur : notes proches non citées + contradictions détectées. Pas un
 * chat — analyse ponctuelle relancée (debounce) quand le corps change.
 *
 * Gardé léger : ne tourne que si Ollama est dispo et la marge activée pour
 * la note. Insère un [[lien]] d'un clic via le callback de l'éditeur.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner, Button } from "@heroui/react";
import { LinkSimple, Warning, ArrowsClockwise, Sparkle } from "@phosphor-icons/react";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { readOllamaHost } from "@/hooks/useAutoTitle";
import { useSettings } from "@/components/settings/SettingsContext";
import { analyzeAmbient, type AmbientResult, type NoteLike } from "@/lib/ai/ambientMargins";

const DEBOUNCE_MS = 4000;

export function AiMarginsPanel({
  noteId,
  noteTitle,
  getBody,
  bodyVersion,
  onInsertLink,
}: {
  noteId: string;
  noteTitle: string;
  /** Lecture du corps courant (ref vivante côté NoteEditor). */
  getBody: () => string;
  /** Incrémenté à chaque frappe — déclenche le debounce sans re-render lourd. */
  bodyVersion: number;
  /** Insère `[[titre]]` à la position du caret. */
  onInsertLink: (title: string) => void;
}): React.JSX.Element | null {
  const { settings } = useSettings();
  const model = settings.ia.ollamaModel;

  const [result, setResult] = useState<AmbientResult | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    const body = getBody();
    if (!body.trim() || body.trim().length < 40) {
      setResult(null);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("running");
    try {
      const host = readOllamaHost();
      // Toutes les notes (avec embeddings) pour le RAG local.
      const all = await trpcVanillaClient.entities.list.query({ typeId: "note", limit: 5000 });
      const others: NoteLike[] = all.items.map((e) => ({
        id: e.id,
        title:
          typeof e.fields["title"] === "string" && e.fields["title"]
            ? (e.fields["title"] as string)
            : e.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "Sans titre",
        body: typeof e.body === "string" ? e.body : "",
        fields: e.fields,
      }));
      const res = await analyzeAmbient({
        current: { id: noteId, title: noteTitle, body, fields: {} },
        others,
        host,
        model,
        signal: ac.signal,
      });
      if (!ac.signal.aborted) {
        setResult(res);
        setStatus("idle");
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setStatus("error");
      }
    }
  }, [getBody, noteId, noteTitle, model]);

  // Relance debouncée à chaque changement du corps.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void run(); }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [bodyVersion, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const links = result?.links ?? [];
  const contradictions = result?.contradictions ?? [];
  const hasFindings = links.length > 0 || contradictions.length > 0;

  return (
    <aside
      className="flex h-full w-full flex-col gap-3 overflow-y-auto py-3 pl-3"
      aria-label="Marges IA"
    >
      <div className="flex items-center justify-between">
        <span
          className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          <Sparkle size={13} weight="fill" /> Marges IA
        </span>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          aria-label="Relancer l'analyse"
          onPress={() => { void run(); }}
          className="h-6 w-6 min-w-0"
        >
          {status === "running" ? (
            <Spinner size="sm" aria-hidden="true" />
          ) : (
            <ArrowsClockwise size={13} style={{ color: "var(--text-muted)" }} />
          )}
        </Button>
      </div>

      {status === "error" && (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          IA indisponible — réessayez plus tard.
        </p>
      )}

      {status !== "running" && !hasFindings && status !== "error" && (
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {result === null
            ? "Écrivez quelques lignes : l'IA repère les notes liées et les contradictions."
            : "Rien à signaler pour l'instant."}
        </p>
      )}

      {/* Liens manquants */}
      {links.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            À relier
          </span>
          {links.map((l) => (
            <div
              key={l.id}
              className="rounded-lg px-2.5 py-2"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
            >
              <div className="flex items-start gap-1.5">
                <LinkSimple size={13} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onInsertLink(l.title)}
                    className="text-left text-[12.5px] font-medium hover:underline"
                    style={{ color: "var(--text-primary)" }}
                    title="Insérer le lien dans la note"
                  >
                    {l.title}
                  </button>
                  {l.reason && (
                    <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                      {l.reason}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Contradictions */}
      {contradictions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Tensions
          </span>
          {contradictions.map((c) => (
            <div
              key={c.id}
              className="rounded-lg px-2.5 py-2"
              style={{ background: "var(--surface-1)", border: "1px solid color-mix(in srgb, var(--destructive) 35%, var(--border-subtle))" }}
            >
              <div className="flex items-start gap-1.5">
                <Warning size={13} className="mt-0.5 shrink-0" style={{ color: "var(--destructive)" }} />
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>
                    {c.title}
                  </div>
                  {c.issue && (
                    <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                      {c.issue}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
