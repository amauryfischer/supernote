"use client";

/**
 * MailAssistantPanel — poser une question sur sa boîte, en français.
 *
 * Panneau volontairement sobre : une question, une réponse courte, et SURTOUT
 * les fils sources, cliquables. Une réponse d'IA sur des emails ne vaut que si
 * on peut aller vérifier dans le fil d'origine — les sources ne sont donc pas
 * un ornement, elles sont la moitié de la fonctionnalité.
 *
 * Recherche locale (mirror) + génération locale (Ollama) : la question comme
 * les emails restent sur la machine.
 */

import { useEffect, useState } from "react";
import { Button, Input, Spinner } from "@heroui/react";
import { Tooltip } from "@supernote/ui";
import { Sparkle, X, PaperPlaneTilt, EnvelopeSimple } from "@phosphor-icons/react";
import { askMailbox, type MailboxAnswer } from "@/lib/mail-assistant";

/** Questions d'amorce : montrent ce que l'assistant sait faire, sans doc. */
const SUGGESTIONS = [
  "Qu'est-ce que j'ai raté cette semaine ?",
  "Qui attend une réponse de moi ?",
  "Où en est le dernier devis ?",
];

export function MailAssistantPanel({
  accountId,
  onClose,
  onOpenThread,
}: {
  accountId: string;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MailboxAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Échap ferme le panneau : les raccourcis de la boîte sont suspendus tant
  // qu'il est ouvert, il faut donc une sortie évidente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await askMailbox(accountId, text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Sparkle size={15} style={{ color: "var(--accent)" }} aria-hidden />
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Assistant de boîte
        </span>
        <span className="flex-1" />
        <Tooltip content="Fermer">
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            aria-label="Fermer l'assistant"
            onPress={onClose}
          >
            <X size={14} />
          </Button>
        </Tooltip>
      </div>

      <div className="flex shrink-0 gap-2 p-3">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pose une question sur tes emails…"
          className="flex-1"
          aria-label="Question sur la boîte mail"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <Button
          variant="primary"
          size="sm"
          isDisabled={busy || !question.trim()}
          onPress={() => void ask(question)}
          aria-label="Poser la question"
        >
          {busy ? <Spinner size="sm" /> : <PaperPlaneTilt size={14} />}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-4">
        {!result && !busy && !error && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Par exemple :
            </span>
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start whitespace-normal py-1.5 text-left text-xs"
                onPress={() => {
                  setQuestion(s);
                  void ask(s);
                }}
              >
                {s}
              </Button>
            ))}
            <p className="pt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
              La recherche et la rédaction se font sur ta machine : ni la question ni tes emails ne
              sont envoyés ailleurs. L'assistant ne voit que la boîte déjà synchronisée.
            </p>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
            <Spinner size="sm" /> Recherche dans la boîte, puis rédaction…
          </div>
        )}

        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
            {error}
          </p>
        )}

        {result && (
          <>
            <p
              className="whitespace-pre-wrap text-sm leading-relaxed"
              style={{ color: "var(--text-primary)" }}
            >
              {result.answer}
            </p>
            {result.window.label && (
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Recherche limitée {result.window.label}.
              </span>
            )}
            {result.sources.length > 0 && (
              <div className="flex flex-col gap-1">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: "var(--text-muted)" }}
                >
                  Fils utilisés
                </span>
                {result.sources.map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onOpenThread(t.id)}
                    className="flex items-start gap-2 rounded-md border p-2 text-left transition-colors hover:border-[var(--accent)]"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    <span
                      className="mt-0.5 shrink-0 rounded px-1 text-[10px] font-semibold"
                      style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span
                        className="truncate text-xs font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {t.subject || "(sans objet)"}
                      </span>
                      <span className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {t.from.name || t.from.email}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {result.sources.length === 0 && (
              <span
                className="inline-flex items-center gap-1.5 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                <EnvelopeSimple size={13} aria-hidden /> Aucun fil correspondant dans la boîte
                synchronisée.
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
