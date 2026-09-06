"use client";

/**
 * Pastille d'état de l'IA locale — jumelle de GitSyncIndicator et
 * OnlineSyncIndicator dans la barre du haut, avec le même langage visuel
 * (déclencheur compact + popover). Répond à « l'IA est-elle branchée, ou
 * faut-il la relancer ? » sans passer par les réglages.
 *
 * La sonde réutilise `probeOllama` de useAutoTitle : une seule implémentation
 * pour toute l'app, y compris la distinction CORS (Ollama tourne mais refuse
 * notre origine) / serveur injoignable, que l'utilisateur ne peut pas deviner.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "@supernote/ui";
import Link from "next/link";
import { Sparkle } from "@phosphor-icons/react";
import { probeOllama, readOllamaHost } from "@/hooks/useAutoTitle";
import { modelInstalled } from "@/lib/ai/blockComments";
import { AI_MOBILE_NOTICE, isAiRuntimeAllowed } from "@/lib/ai/ai-runtime";
import { getAiSettings } from "@/lib/ai/settings";

const FALLBACK_MODEL = "qwen3.5:9b";

export type AiStatus =
  | "checking"
  | "paused-mobile"
  | "ready"
  | "model-missing"
  | "cors"
  | "unreachable";

export interface AiStatusSnapshot {
  status: AiStatus;
  host: string;
  origin: string;
  model: string;
  installed: string[];
  error?: string;
}

function readPreferredModel(): string {
  if (typeof window === "undefined") return FALLBACK_MODEL;
  return getAiSettings().model || FALLBACK_MODEL;
}

/**
 * Sonde l'IA locale et résout l'état affichable. Exporté pour que le drawer
 * mobile partage exactement la même lecture que la barre du haut.
 */
export async function probeAiStatus(): Promise<AiStatusSnapshot> {
  const model = readPreferredModel();
  // Sur mobile l'IA est volontairement en retrait : ne pas sonder du tout,
  // sinon la pastille annoncerait « injoignable » pour un choix délibéré.
  if (!isAiRuntimeAllowed()) {
    return {
      status: "paused-mobile",
      host: readOllamaHost(),
      origin: "",
      model,
      installed: [],
    };
  }
  const result = await probeOllama();
  const installed = (result.models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => typeof n === "string");

  if (result.status === "ok") {
    return {
      status: modelInstalled(model, installed) ? "ready" : "model-missing",
      host: result.host,
      origin: result.origin,
      model,
      installed,
    };
  }

  return {
    status: result.status === "cors" ? "cors" : "unreachable",
    host: result.host,
    origin: result.origin,
    model,
    installed,
    error: result.error,
  };
}

export const AI_STATUS_COLOR: Record<AiStatus, string> = {
  checking: "var(--text-muted)",
  "paused-mobile": "var(--text-muted)",
  ready: "oklch(0.65 0.16 150)",
  "model-missing": "var(--warning)",
  cors: "var(--warning)",
  unreachable: "var(--danger)",
};

export function aiStatusLabel(snap: AiStatusSnapshot): string {
  switch (snap.status) {
    case "checking":
      return "Vérification de l'IA locale…";
    case "paused-mobile":
      return AI_MOBILE_NOTICE;
    case "ready":
      return `IA connectée · ${snap.model}`;
    case "model-missing":
      return `Modèle ${snap.model} non installé`;
    case "cors":
      return "Ollama refuse cette origine";
    case "unreachable":
      return "IA injoignable";
  }
}

/** Détail actionnable : ce que l'utilisateur doit faire pour réparer. */
export function aiStatusHint(snap: AiStatusSnapshot): string | null {
  switch (snap.status) {
    case "paused-mobile":
      return "Écris librement : la synchronisation transmettra le texte.";
    case "model-missing":
      return `ollama pull ${snap.model}`;
    case "cors":
      return `OLLAMA_ORIGINS=${snap.origin} ollama serve`;
    case "unreachable":
      return `Aucune réponse de ${snap.host} — Ollama est-il lancé ?`;
    default:
      return null;
  }
}

export function useAiStatus(): {
  snapshot: AiStatusSnapshot;
  recheck: () => void;
} {
  const [snapshot, setSnapshot] = useState<AiStatusSnapshot>(() => ({
    status: "checking",
    host: readOllamaHost(),
    origin: "",
    model: FALLBACK_MODEL,
    installed: [],
  }));
  // Une sonde en vol au démontage ne doit pas écrire dans un composant parti.
  const aliveRef = useRef(true);

  const recheck = useCallback(() => {
    setSnapshot((s) => ({ ...s, status: "checking" }));
    void probeAiStatus().then((next) => {
      if (aliveRef.current) setSnapshot(next);
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    recheck();
    // Revenir sur l'onglet est le moment où l'utilisateur vient de relancer
    // Ollama dans un terminal : c'est là qu'une resonde a le plus de valeur.
    const onVisible = () => {
      if (document.visibilityState === "visible") recheck();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      aliveRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [recheck]);

  return { snapshot, recheck };
}

export function AiStatusIndicator() {
  const { snapshot, recheck } = useAiStatus();
  const [open, setOpen] = useState(false);

  const label = aiStatusLabel(snapshot);
  const hint = aiStatusHint(snapshot);
  const color = AI_STATUS_COLOR[snapshot.status];

  return (
    <div className="relative">
      <Tooltip content={label}>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`État de l'IA locale : ${label}`}
          className="flex h-8 w-8 items-center justify-center rounded-full"
        >
          <Sparkle
            size={14}
            weight={snapshot.status === "ready" ? "fill" : "regular"}
            className={snapshot.status === "checking" ? "animate-pulse" : undefined}
            style={{ color }}
          />
        </Button>
      </Tooltip>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute right-0 top-10 z-50 w-72 rounded-xl border p-3 shadow-xl"
            style={{
              backgroundColor: "var(--surface-1)",
              borderColor: "var(--border-subtle)",
              boxShadow:
                "0 12px 24px -8px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)",
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: color,
                }}
              />
              <span
                className="text-[13px] font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {label}
              </span>
            </div>

            <div
              className="mb-2 truncate text-[11px]"
              style={{ color: "var(--text-muted)" }}
              title={snapshot.host}
            >
              {snapshot.host.replace(/^https?:\/\//, "")}
            </div>

            {hint && (
              <p
                className="mb-3 rounded-lg px-2 py-1.5 font-mono text-[11px] leading-relaxed"
                style={{
                  backgroundColor: "var(--surface-2)",
                  color: "var(--text-secondary)",
                }}
              >
                {hint}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={recheck}
                isDisabled={snapshot.status === "checking"}
                className="flex-1 text-[13px] font-medium"
              >
                {snapshot.status === "checking" ? "Test…" : "Reconnecter"}
              </Button>
              <Link
                href="/parametres"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-lg px-3 py-2 text-center text-[13px] font-medium"
                style={{
                  backgroundColor: "var(--surface-2)",
                  color: "var(--text-primary)",
                }}
              >
                Réglages
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
