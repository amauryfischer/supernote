"use client";

/**
 * AssistantChat — RAG-based "ask your vault" interface.
 * Embeds the query, finds top-10 similar notes, streams an Ollama answer.
 */

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { Button, Spinner, ChipRoot } from "@heroui/react";
import { ArrowUp, MagnifyingGlass, Robot, Article } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";
import {
  embedQuery,
  cosineSimilarity,
  parseEmbeddingField,
  chatStream,
  DEFAULT_EMBED_MODEL,
  type ChatMessage,
} from "@/lib/rag";
import { OLLAMA_HOST_KEY, DEFAULT_OLLAMA_HOST } from "@/hooks/useAutoTitle";
import type { EntitySummary } from "@supernote/ipc";

// ── Types ──────────────────────────────────────────────────────────────────

interface Citation {
  id: string;
  title: string;
  score: number;
  body: string;
}

interface QaTurn {
  question: string;
  answer: string;
  citations: Citation[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getOllamaHost(): string {
  if (typeof window === "undefined") return DEFAULT_OLLAMA_HOST;
  try {
    const stored = window.localStorage.getItem(OLLAMA_HOST_KEY);
    if (stored?.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  return DEFAULT_OLLAMA_HOST;
}

function getOllamaModel(): string {
  if (typeof window === "undefined") return "llama3.2";
  try {
    const raw = window.localStorage.getItem("supernote.settings");
    if (raw) {
      const parsed = JSON.parse(raw) as { ia?: { ollamaModel?: string } };
      if (parsed.ia?.ollamaModel) return parsed.ia.ollamaModel;
    }
  } catch {
    /* ignore */
  }
  return "llama3.2";
}

function getEntityTitle(e: EntitySummary): string {
  const t = e.fields["title"];
  if (typeof t === "string" && t.trim()) return t.trim();
  return e.filePath.split("/").pop() ?? e.id;
}

function pickTopK(
  queryVec: number[],
  entities: EntitySummary[],
  k: number,
): Citation[] {
  const scored = entities
    .map((e) => {
      const vec = parseEmbeddingField(e.fields["embedding"]);
      if (!vec) return null;
      return {
        id: e.id,
        title: getEntityTitle(e),
        score: cosineSimilarity(queryVec, vec),
        body: e.body ?? "",
      } satisfies Citation;
    })
    .filter((x): x is Citation => x !== null)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function buildPrompt(question: string, citations: Citation[]): ChatMessage[] {
  const context = citations
    .map((c, i) => `[${i + 1}] ${c.title}\n${c.body.slice(0, 800)}`)
    .join("\n\n---\n\n");

  return [
    {
      role: "system",
      content: `Tu es l'assistant Supernote. Réponds en français à partir des extraits de notes ci-dessous.\nSi la réponse n'est pas dans les notes, dis-le clairement.\n\n${context}`,
    },
    { role: "user", content: question },
  ];
}

// ── Component ──────────────────────────────────────────────────────────────

export function AssistantChat() {
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [history, setHistory] = useState<QaTurn[]>([]);
  const streamRef = useRef("");

  const entitiesQuery = trpc.entities.list.useQuery(
    { limit: 5000, offset: 0 },
    { staleTime: 60_000 },
  );

  const host = getOllamaHost();
  const chatModel = getOllamaModel();

  const handleSubmit = useCallback(async () => {
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    setStreamBuffer("");
    streamRef.current = "";
    setStreaming(true);

    try {
      setStatus("Recherche dans le vault…");
      const vec = await embedQuery(q, host, DEFAULT_EMBED_MODEL);

      const allEntities = entitiesQuery.data?.items ?? [];
      const citations = pickTopK(vec, allEntities, 10);

      if (citations.length === 0) {
        setStatus("Aucune note indexée trouvée. Indexez d'abord votre vault dans Paramètres → IA Ollama.");
        setStreaming(false);
        return;
      }

      setStatus(null);
      const messages = buildPrompt(q, citations);

      await chatStream(host, chatModel, messages, (chunk) => {
        streamRef.current += chunk;
        setStreamBuffer(streamRef.current);
      });

      const turn: QaTurn = {
        question: q,
        answer: streamRef.current,
        citations,
      };
      setHistory((prev) => [...prev, turn]);
      setStreamBuffer("");
      streamRef.current = "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Erreur: ${msg}`);
    } finally {
      setStreaming(false);
    }
  }, [question, streaming, host, chatModel, entitiesQuery.data]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const indexedCount = (entitiesQuery.data?.items ?? []).filter(
    (e) => parseEmbeddingField(e.fields["embedding"]) !== null,
  ).length;

  return (
    <div className="flex h-full flex-col" style={{ color: "var(--text-primary)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
      >
        <Robot size={20} style={{ color: "var(--accent)" }} />
        <div className="flex-1">
          <h1 className="text-sm font-semibold">Demander à votre vault</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {chatModel} · {DEFAULT_EMBED_MODEL} · {indexedCount} notes indexées
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {history.length === 0 && !streaming && (
          <div
            className="flex flex-col items-center justify-center gap-2 py-16 text-center"
            style={{ color: "var(--text-muted)" }}
          >
            <MagnifyingGlass size={40} weight="thin" />
            <p className="text-sm">Posez une question sur vos notes</p>
          </div>
        )}

        {history.map((turn, idx) => (
          <TurnBlock key={idx} turn={turn} />
        ))}

        {streaming && (
          <div>
            <p className="mb-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Assistant
            </p>
            <div
              className="rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-2)" }}
            >
              {streamBuffer}
              <span className="inline-block w-1.5 h-4 ml-0.5 animate-pulse bg-current opacity-60" />
            </div>
          </div>
        )}
      </div>

      {/* Status */}
      {status && (
        <div
          className="px-4 py-1.5 text-xs"
          style={{ color: "var(--text-muted)", backgroundColor: "var(--surface-2)" }}
        >
          {status}
        </div>
      )}

      {/* Input */}
      <div
        className="flex items-center gap-2 border-t px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Posez une question sur vos notes…"
          disabled={streaming}
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-2)",
            color: "var(--text-primary)",
          }}
          aria-label="Question"
        />
        <Button
          isIconOnly
          onPress={() => void handleSubmit()}
          isDisabled={!question.trim() || streaming}
          size="sm"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          aria-label="Demander"
        >
          {streaming ? <Spinner size="sm" color="current" /> : <ArrowUp size={16} />}
        </Button>
      </div>
    </div>
  );
}

// ── TurnBlock ──────────────────────────────────────────────────────────────

interface TurnBlockProps {
  turn: QaTurn;
}

function TurnBlock({ turn }: TurnBlockProps) {
  const [showCitations, setShowCitations] = useState(false);

  return (
    <div className="space-y-2">
      {/* Question */}
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-lg px-3 py-2 text-sm"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {turn.question}
        </div>
      </div>

      {/* Answer */}
      <div>
        <p className="mb-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          Assistant
        </p>
        <div
          className="rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-2)" }}
        >
          {turn.answer}
        </div>
      </div>

      {/* Citations toggle */}
      {turn.citations.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowCitations((v) => !v)}
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            <Article size={12} />
            {showCitations ? "Masquer" : "Voir"} les {turn.citations.length} sources
          </button>

          {showCitations && (
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {turn.citations.map((c, i) => (
                <CitationCard key={c.id} citation={c} rank={i + 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── CitationCard ──────────────────────────────────────────────────────────

interface CitationCardProps {
  citation: Citation;
  rank: number;
}

function CitationCard({ citation, rank }: CitationCardProps) {
  const pct = Math.round(citation.score * 100);
  return (
    <div
      className="flex items-start gap-2 rounded-lg border px-2.5 py-2"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
    >
      <span
        className="shrink-0 rounded px-1 py-0.5 text-[10px] font-mono font-semibold"
        style={{
          backgroundColor: "var(--accent-subtle)",
          color: "var(--accent)",
        }}
      >
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <p className="truncate text-xs font-medium" style={{ color: "var(--text-primary)" }}>
          {citation.title}
        </p>
        <ChipRoot size="sm" variant="soft" className="mt-0.5 text-[10px]">
          {pct}% similarité
        </ChipRoot>
      </div>
    </div>
  );
}
