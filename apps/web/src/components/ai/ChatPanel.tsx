"use client";

/**
 * /ai — agentic chat panel.
 *
 * Drives a local Ollama instance via `@supernote/ai/agent`. Each user turn
 * runs the agent loop with our tRPC-backed tools (see ../../lib/ai/tools)
 * until the model produces a terminal assistant message. Tool calls
 * appear inline as collapsible cards so the user can audit every read /
 * write the model performs against their vault.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button, TextArea, Card, Chip, Spinner } from "@heroui/react";
import { ArrowUp, Robot, Wrench, Warning, Stop } from "@phosphor-icons/react";
import { createOllamaClient, runAgent, type AgentEvent, type ChatMessage } from "@supernote/ai";
import { DEFAULT_TOOLS } from "@/lib/ai/tools";
import { getAiSettings } from "@/lib/ai/settings";
import { NativeSelect } from "@/components/settings/NativeSelect";

const SYSTEM_PROMPT = `Tu es l'assistant intégré à Supernote, un outil personnel de prise de notes.
Tu as accès en lecture ET en écriture au vault de l'utilisateur via des outils :
- searchNotes / listNotes / getNote : pour explorer ses notes
- createNote / updateNote : pour modifier ses notes

Règles :
- Cite toujours l'id et le chemin des notes que tu références.
- Avant de créer ou modifier, vérifie d'abord ce qui existe (search/list).
- Réponds en français, de façon concise.
- Si l'utilisateur demande "trouve X" ou "que sais-tu sur X", commence par searchNotes.
- Si tu appelles plusieurs outils, fais-le séquentiellement et utilise les résultats pour affiner.`;

interface DisplayUserItem {
  kind: "user";
  text: string;
}
interface DisplayAssistantItem {
  kind: "assistant";
  text: string;
}
interface DisplayToolItem {
  kind: "tool";
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: "running" | "done" | "error";
}
type DisplayItem = DisplayUserItem | DisplayAssistantItem | DisplayToolItem;

interface OllamaProbe {
  state: "unknown" | "available" | "unavailable";
  models: string[];
  error?: string;
}

function previewArgs(args: Record<string, unknown>): string {
  const flat = JSON.stringify(args);
  return flat.length > 120 ? flat.slice(0, 120) + "…" : flat;
}

function previewResult(result: unknown): string {
  if (result == null) return "null";
  if (typeof result === "string") {
    return result.length > 300 ? result.slice(0, 300) + "…" : result;
  }
  try {
    const json = JSON.stringify(result, null, 2);
    return json.length > 1200 ? json.slice(0, 1200) + "…" : json;
  } catch {
    return String(result);
  }
}

export function ChatPanel() {
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<OllamaProbe>({ state: "unknown", models: [] });
  const settings = useMemo(() => getAiSettings(), []);
  const [activeModel, setActiveModel] = useState(settings.model);
  const messagesRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const client = useMemo(
    () => createOllamaClient({ baseUrl: settings.baseUrl, defaultModel: activeModel }),
    [settings.baseUrl, activeModel],
  );

  // One-shot Ollama health probe on mount. We surface a banner instead of
  // failing inside the agent loop so the user knows immediately whether
  // their local Ollama is reachable.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ok = await client.isAvailable();
        if (cancelled) return;
        if (!ok) {
          setProbe({ state: "unavailable", models: [], error: "Ollama injoignable sur " + settings.baseUrl });
          return;
        }
        const models = await client.listModels();
        if (cancelled) return;
        const names = models.map((m) => m.name);
        setProbe({ state: "available", models: names });
        // If the configured default isn't installed, fall back to the
        // first available model so the first send doesn't 404.
        if (names.length > 0 && !names.includes(activeModel) && names[0]) {
          setActiveModel(names[0]);
        }
      } catch (err) {
        if (cancelled) return;
        setProbe({
          state: "unavailable",
          models: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, settings.baseUrl, activeModel]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    setError(null);
    setInput("");

    // Push the user message into both the UI list and the agent history.
    messagesRef.current = [...messagesRef.current, { role: "user", content: text }];
    setItems((prev) => [...prev, { kind: "user", text }]);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Append an empty assistant bubble we'll grow as text streams in.
    let assistantIndex = -1;
    setItems((prev) => {
      assistantIndex = prev.length;
      return [...prev, { kind: "assistant", text: "" }];
    });

    const handleEvent = (event: AgentEvent) => {
      if (event.type === "assistant_text") {
        setItems((prev) => {
          const next = [...prev];
          // Find the latest assistant slot (could shift if tool items were
          // inserted after the bubble was created).
          for (let i = next.length - 1; i >= 0; i--) {
            const it = next[i];
            if (it && it.kind === "assistant") {
              next[i] = { kind: "assistant", text: it.text + event.text };
              break;
            }
          }
          return next;
        });
      } else if (event.type === "tool_call") {
        setItems((prev) => [
          ...prev,
          {
            kind: "tool",
            id: event.id,
            name: event.name,
            args: event.arguments,
            status: "running",
          },
        ]);
      } else if (event.type === "tool_result") {
        setItems((prev) =>
          prev.map((it) => {
            if (it.kind !== "tool" || it.id !== event.id) return it;
            const next: DisplayToolItem = {
              ...it,
              status: event.error ? "error" : "done",
              result: event.result,
            };
            if (event.error) next.error = event.error;
            return next;
          }),
        );
      } else if (event.type === "step_done") {
        // After a tool round, open a fresh assistant bubble for the next
        // model turn so its text doesn't merge into the prior message.
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "assistant" && last.text === "") return prev;
          return [...prev, { kind: "assistant", text: "" }];
        });
      }
    };

    try {
      const result = await runAgent({
        client,
        model: activeModel,
        system: SYSTEM_PROMPT,
        messages: messagesRef.current,
        tools: DEFAULT_TOOLS,
        onEvent: handleEvent,
        signal: controller.signal,
      });
      messagesRef.current = result.messages;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
      // Drop any trailing empty assistant bubble so the input area
      // doesn't sit under a phantom message.
      setItems((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.kind === "assistant" && last.text === "") return prev.slice(0, -1);
        return prev;
      });
      // Anchor reference so the linter sees the index used somewhere.
      void assistantIndex;
    }
  }, [client, input, running, activeModel]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: "var(--surface-0)" }}>
      <header
        className="flex items-center justify-between gap-3 border-b px-6 py-3"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <Robot size={20} weight="duotone" style={{ color: "var(--accent)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Assistant Supernote
          </span>
          {probe.state === "available" && probe.models.length > 0 ? (
            <NativeSelect
              value={activeModel}
              onChange={setActiveModel}
              options={probe.models.map((m) => ({ value: m, label: m }))}
            />
          ) : (
            <Chip size="sm" variant="soft" className="ml-2">
              {activeModel}
            </Chip>
          )}
        </div>
        <div className="flex items-center gap-2">
          {probe.state === "available" && (
            <Chip size="sm" color="success" variant="soft">
              Ollama OK · {probe.models.length} modèle{probe.models.length > 1 ? "s" : ""}
            </Chip>
          )}
          {probe.state === "unavailable" && (
            <Chip size="sm" color="danger" variant="soft">
              <span className="flex items-center gap-1">
                <Warning size={12} />
                Ollama indisponible
              </span>
            </Chip>
          )}
          {probe.state === "unknown" && <Spinner size="sm" />}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {items.length === 0 && probe.state !== "unavailable" && (
            <div
              className="rounded-lg border p-6 text-sm"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
                backgroundColor: "var(--surface-1)",
              }}
            >
              <p className="mb-2 font-medium" style={{ color: "var(--text-primary)" }}>
                Pose-moi une question sur tes notes.
              </p>
              <p>
                Exemples : « Résume mes notes sur le projet X », « Crée une note todo pour appeler
                Marc demain », « Trouve toutes les notes taggées #idée du mois dernier ».
              </p>
            </div>
          )}
          {probe.state === "unavailable" && (
            <Card>
              <div className="flex items-start gap-3 p-4">
                <Warning size={20} weight="fill" style={{ color: "var(--danger)" }} />
                <div className="text-sm">
                  <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                    Ollama n'est pas accessible.
                  </p>
                  <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
                    {probe.error ?? "Lance `ollama serve` localement puis recharge la page."}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {items.map((item, idx) =>
            item.kind === "user" ? (
              <UserBubble key={idx} text={item.text} />
            ) : item.kind === "assistant" ? (
              <AssistantBubble key={idx} text={item.text} running={running && idx === items.length - 1} />
            ) : (
              <ToolCallCard key={item.id} item={item} />
            ),
          )}
        </div>
      </div>

      {error && (
        <div
          className="border-t px-6 py-2 text-xs"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--danger)",
            backgroundColor: "var(--danger-subtle, transparent)",
          }}
        >
          {error}
        </div>
      )}

      <div className="border-t px-6 py-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <TextArea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Demande à l'assistant…"
            disabled={running || probe.state === "unavailable"}
            className="flex-1 resize-none px-3 py-2 text-sm outline-none"
          />
          {running ? (
            <Button isIconOnly variant="danger" onPress={handleStop} aria-label="Stop">
              <Stop size={18} weight="fill" />
            </Button>
          ) : (
            <Button
              isIconOnly
              variant="primary"
              onPress={() => void handleSend()}
              isDisabled={!input.trim() || probe.state === "unavailable"}
              aria-label="Envoyer"
            >
              <ArrowUp size={18} weight="bold" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-sm px-4 py-2 text-sm"
        style={{
          backgroundColor: "var(--accent-subtle)",
          color: "var(--text-primary)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ text, running }: { text: string; running: boolean }) {
  if (!text && !running) return null;
  return (
    <div className="flex justify-start">
      <div
        className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm px-4 py-2 text-sm"
        style={{
          backgroundColor: "var(--surface-1)",
          color: "var(--text-primary)",
        }}
      >
        {text}
        {running && (
          <span className="ml-1 inline-block">
            <Spinner size="sm" />
          </span>
        )}
      </div>
    </div>
  );
}

function ToolCallCard({ item }: { item: DisplayToolItem }) {
  const [open, setOpen] = useState(false);
  const chipColor: "default" | "danger" | "success" =
    item.status === "running" ? "default" : item.status === "error" ? "danger" : "success";
  return (
    <Card
      className="border"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      <div className="flex flex-col gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between gap-2 text-left"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Wrench size={14} style={{ color: "var(--text-muted)" }} />
            <span
              className="font-mono text-xs font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {item.name}
            </span>
            <span
              className="truncate font-mono text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              {previewArgs(item.args)}
            </span>
          </div>
          <Chip size="sm" variant="soft" color={chipColor}>
            {item.status === "running" ? "…" : item.status === "error" ? "err" : "ok"}
          </Chip>
        </button>
        {open && (
          <div className="grid gap-2 pt-1">
            <pre
              className="overflow-x-auto rounded p-2 text-xs"
              style={{
                backgroundColor: "var(--surface-2)",
                color: "var(--text-secondary)",
              }}
            >
              {JSON.stringify(item.args, null, 2)}
            </pre>
            {item.status !== "running" && (
              <pre
                className="overflow-x-auto rounded p-2 text-xs"
                style={{
                  backgroundColor: "var(--surface-2)",
                  color: item.error ? "var(--danger)" : "var(--text-secondary)",
                }}
              >
                {item.error ?? previewResult(item.result)}
              </pre>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
