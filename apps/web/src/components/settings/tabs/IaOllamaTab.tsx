"use client";

import { Robot, CircleNotch, CheckCircle, XCircle, Copy, Check } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { NativeSelect } from "../NativeSelect";
import { ToggleSwitch } from "../ToggleSwitch";
import { RangeSlider } from "../RangeSlider";
import type { IaSettings } from "../types";
import {
  AUTO_TITLE_ENABLED_KEY,
  AUTO_TITLE_MODEL_KEY,
  DEFAULT_OLLAMA_HOST,
  OLLAMA_HOST_KEY,
  probeOllama,
  type OllamaProbeResult,
} from "@/hooks/useAutoTitle";
import { AUTO_TAG_ENABLED_KEY } from "@/hooks/useAutoTag";

const FALLBACK_MODELS = [
  "llama3.2",
  "llama3.2:1b",
  "llama3.1",
  "mistral",
  "mistral-nemo",
  "phi3",
  "gemma2",
  "qwen2.5",
];

const AI_FEATURES: Array<{
  key: keyof IaSettings;
  label: string;
  description: string;
}> = [
  {
    key: "autoTagging",
    label: "Auto-tagging",
    description: "Tagge automatiquement les notes sauvegardees via Ollama",
  },
  {
    key: "autoClassify",
    label: "Auto-classification",
    description: "Classe automatiquement les nouvelles notes par type",
  },
  {
    key: "mentionDetection",
    label: "Detection de mentions",
    description: "Detecte @personnes et #lieux dans le texte",
  },
  {
    key: "actionExtraction",
    label: "Extraction d'actions",
    description: "Identifie les taches et actions a faire",
  },
  {
    key: "dailyBrief",
    label: "Daily brief",
    description: "Resume quotidien de votre activite",
  },
  {
    key: "rag",
    label: "Recherche semantique (RAG)",
    description: "Recherche par sens dans vos notes",
  },
];

/**
 * Env-var-prefixed launch command we tell the user to run when CORS is the
 * culprit. We default to `*` because:
 *   - it's the only value that reliably works across Ollama versions, AND
 *   - it covers both http://localhost:3100 and http://127.0.0.1:3100 —
 *     Ollama treats those as different origins.
 */
const OLLAMA_ORIGINS_CMD = "OLLAMA_ORIGINS=* ollama serve";

export function IaOllamaTab() {
  const { settings, updateSettings } = useSettings();
  const { ia } = settings;

  // Auto-title toggle is persisted in localStorage (independent of the
  // in-memory AppSettings) so the editor hooks can read it without going
  // through React context — they fire from non-React debounced timers.
  const [autoTitle, setAutoTitle] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setAutoTitle(window.localStorage.getItem(AUTO_TITLE_ENABLED_KEY) === "1");
    } catch {
      /* localStorage may be unavailable (private mode) — leave default off */
    }
  }, []);
  const toggleAutoTitle = (v: boolean) => {
    setAutoTitle(v);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(AUTO_TITLE_ENABLED_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // Auto-tag toggle — same persistence pattern as auto-title.
  const [autoTag, setAutoTag] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setAutoTag(window.localStorage.getItem(AUTO_TAG_ENABLED_KEY) === "1");
    } catch {
      /* localStorage unavailable — leave default off */
    }
  }, []);
  const toggleAutoTag = (v: boolean) => {
    setAutoTag(v);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(AUTO_TAG_ENABLED_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // Configurable Ollama host — kept in localStorage so non-React code paths
  // (the auto-title hook, future workers) can read it without React context.
  const [host, setHost] = useState<string>(DEFAULT_OLLAMA_HOST);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(OLLAMA_HOST_KEY);
      if (raw && raw.trim()) setHost(raw.trim());
    } catch {
      /* ignore */
    }
  }, []);
  const persistHost = (v: string) => {
    setHost(v);
    if (typeof window === "undefined") return;
    try {
      const trimmed = v.trim();
      if (trimmed && trimmed !== DEFAULT_OLLAMA_HOST) {
        window.localStorage.setItem(OLLAMA_HOST_KEY, trimmed);
      } else {
        window.localStorage.removeItem(OLLAMA_HOST_KEY);
      }
    } catch {
      /* ignore */
    }
  };

  const updateIa = (patch: Partial<IaSettings>) => {
    updateSettings("ia", { ...ia, ...patch });
    // Mirror the model name to localStorage so useAutoTitle can read it
    // without dragging the React settings context into a worker-ish hook.
    if (patch.ollamaModel && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(AUTO_TITLE_MODEL_KEY, patch.ollamaModel);
      } catch {
        /* ignore */
      }
    }
  };

  // Mirror initial model on mount so localStorage matches whatever
  // DEFAULT_SETTINGS / persisted AppSettings put into context.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(AUTO_TITLE_MODEL_KEY, ia.ollamaModel);
    } catch {
      /* ignore */
    }
  }, [ia.ollamaModel]);

  // ── Live Ollama probe ───────────────────────────────────────────────────
  // We deliberately bypass tRPC here: `system.ollamaStatus` is `notImplemented`
  // in the PWA build, so any call to it rejects and the banner showed
  // "Ollama non détecté" forever. Probing /api/tags directly from the
  // browser is the only reliable path in this build.
  const [probe, setProbe] = useState<OllamaProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const probedOnceRef = useRef(false);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      const result = await probeOllama(host);
      setProbe(result);
    } finally {
      setProbing(false);
    }
  }, [host]);

  // Initial probe on mount + whenever the host changes.
  useEffect(() => {
    // Skip the very first effect run if it's the SSR boot — we want it to
    // fire on the client mount, which happens once. `probedOnceRef` exists
    // mainly to prevent React 18 strict-mode double-fire from triggering
    // two flight probes against the user's Ollama.
    if (probedOnceRef.current) {
      void runProbe();
      return;
    }
    probedOnceRef.current = true;
    void runProbe();
  }, [runProbe]);

  const isAvailable = probe?.status === "ok";
  const liveModels = probe?.models?.map((m) => m.name) ?? [];
  const modelOptions = (liveModels.length > 0 ? liveModels : FALLBACK_MODELS).map((m) => ({
    value: m,
    label: m,
  }));

  // Status text — different message per failure mode. Only the "ok" branch
  // is the success case; the others map to actionable hints.
  const origin = probe?.origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const corsCmd = OLLAMA_ORIGINS_CMD;
  const [copied, setCopied] = useState(false);
  const copyCorsCmd = async () => {
    try {
      await navigator.clipboard.writeText(corsCmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* clipboard may be blocked (insecure context) — silently ignore */
    }
  };

  let banner: { tone: "ok" | "error" | "warn"; text: string };
  if (probing && !probe) {
    banner = { tone: "warn", text: "Verification Ollama..." };
  } else if (isAvailable) {
    banner = {
      tone: "ok",
      text: `Ollama actif — ${liveModels.length} modele${liveModels.length !== 1 ? "s" : ""} disponible${liveModels.length !== 1 ? "s" : ""}`,
    };
  } else if (probe?.status === "cors") {
    banner = {
      tone: "error",
      text: `Ollama refuse l'origine ${origin}. Lance Ollama avec OLLAMA_ORIGINS=* pour autoriser le navigateur.`,
    };
  } else if (probe?.status === "http") {
    banner = {
      tone: "error",
      text: `Ollama a repondu HTTP ${probe.httpStatus ?? "?"} sur ${probe.host}/api/tags.`,
    };
  } else if (probe?.status === "timeout") {
    banner = {
      tone: "error",
      text: `Ollama injoignable (timeout) a ${probe.host}. Verifie que 'ollama serve' tourne.`,
    };
  } else {
    banner = {
      tone: "error",
      text: "Ollama injoignable. Verifie que 'ollama serve' tourne.",
    };
  }

  // ── Diagnostic block ────────────────────────────────────────────────────
  // Surface the EXACT probe result + a "Copier le diagnostic" button so the
  // user can paste a full debug bundle when asking for help. Without this,
  // the user sees only "non détecté" and we (and they) are flying blind.
  const probeUrl = `${probe?.host ?? host}/api/tags`;
  const recommendation = (() => {
    if (!probe) return "";
    switch (probe.status) {
      case "ok":
        return "";
      case "cors":
        // Could be CORS proper OR Chrome Private Network Access. Mention both.
        return "Cause probable: CORS ou Private Network Access (PNA) de Chrome. Si OLLAMA_ORIGINS=* est deja actif, lance Chrome avec --disable-features=PrivateNetworkAccessForWorkers,PrivateNetworkAccessRespectPreflightResults,PrivateNetworkAccessSendPreflights ou bascule chrome://flags/#block-insecure-private-network-requests sur Disabled.";
      case "http":
        return `Ollama a repondu HTTP ${probe.httpStatus}. L'URL /api/tags est peut-etre desactivee ou modifiee.`;
      case "timeout":
        return "Le serveur n'a pas repondu dans les delais. Verifie que 'ollama serve' tourne et qu'aucun firewall ne bloque le port.";
      case "network":
        return "Pas de connectivite reseau detectee, ou aucun service sur ce port.";
    }
  })();
  const [diagCopied, setDiagCopied] = useState(false);
  const copyDiagnostic = async () => {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "?";
    const online = typeof navigator !== "undefined" ? navigator.onLine : "?";
    const bundle = [
      "=== Diagnostic Ollama ===",
      `Date: ${new Date().toISOString()}`,
      `Origin: ${origin}`,
      `URL probee: ${probeUrl}`,
      `Statut probe: ${probe?.status ?? "(en cours)"}`,
      probe?.httpStatus !== undefined ? `HTTP: ${probe.httpStatus}` : "",
      probe?.error ? `Erreur: ${probe.error}` : "",
      `navigator.onLine: ${online}`,
      `User-Agent: ${ua}`,
      `Modeles detectes: ${liveModels.length > 0 ? liveModels.join(", ") : "(aucun)"}`,
      `Recommandation: ${recommendation || "(aucune)"}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(bundle);
      setDiagCopied(true);
      window.setTimeout(() => setDiagCopied(false), 1_500);
    } catch {
      /* clipboard may be blocked in insecure contexts — silently ignore */
    }
  };

  return (
    <div className="space-y-6">
      <SettingSection
        title="IA & Ollama"
        description="Configuration de l'intelligence artificielle locale"
        icon={<Robot size={16} />}
      >
        {/* Ollama status banner */}
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor:
              banner.tone === "ok"
                ? "var(--success-border, #86efac)"
                : banner.tone === "error"
                ? "var(--danger-border, #fecaca)"
                : "var(--border)",
            backgroundColor:
              banner.tone === "ok"
                ? "var(--success-subtle, #f0fdf4)"
                : banner.tone === "error"
                ? "var(--danger-subtle, #fef2f2)"
                : "var(--surface-2)",
            color:
              banner.tone === "ok"
                ? "var(--success, #16a34a)"
                : banner.tone === "error"
                ? "var(--danger, #dc2626)"
                : "var(--text-muted)",
          }}
        >
          {probing ? (
            <CircleNotch size={13} className="animate-spin shrink-0" />
          ) : isAvailable ? (
            <CheckCircle size={13} weight="fill" className="shrink-0" />
          ) : (
            <XCircle size={13} weight="fill" className="shrink-0" />
          )}
          <span className="flex-1">{banner.text}</span>
          <button
            onClick={() => void runProbe()}
            disabled={probing}
            className="ml-auto flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 transition-all hover:opacity-80 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface-1)" }}
          >
            {probing && <CircleNotch size={11} className="animate-spin" />}
            Tester la connexion
          </button>
        </div>

        {/* CORS guidance — only shown when the probe says CORS is the problem */}
        {probe?.status === "cors" && (
          <div
            className="rounded-lg border px-3 py-2 text-xs space-y-2"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-2)",
              color: "var(--text-secondary)",
            }}
          >
            <p>
              Ollama tourne mais bloque les requetes du navigateur. Relance le avec :
            </p>
            <div
              className="flex items-center gap-2 rounded border px-2 py-1 font-mono"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-1)",
                color: "var(--text-primary)",
              }}
            >
              <code className="flex-1 truncate">{corsCmd}</code>
              <button
                onClick={() => void copyCorsCmd()}
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-all hover:opacity-80"
                style={{ color: "var(--text-secondary)" }}
                aria-label="Copier la commande"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? "Copie" : "Copier"}
              </button>
            </div>
            <p className="text-[11px] opacity-80">
              Si OLLAMA_ORIGINS=* est deja actif et que ca ne fonctionne toujours pas,
              Chrome bloque peut-etre la requete via Private Network Access (PNA).
              Voir le diagnostic ci-dessous.
            </p>
          </div>
        )}

        {/* Diagnostic block — always shown so the user can copy a debug bundle */}
        {probe && (
          <div
            className="rounded-lg border px-3 py-2 text-xs space-y-2"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-2)",
              color: "var(--text-secondary)",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <strong style={{ color: "var(--text-primary)" }}>Diagnostic</strong>
              <button
                onClick={() => void copyDiagnostic()}
                className="flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 transition-all hover:opacity-80"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-secondary)",
                  backgroundColor: "var(--surface-1)",
                }}
                aria-label="Copier le diagnostic"
              >
                {diagCopied ? <Check size={11} /> : <Copy size={11} />}
                {diagCopied ? "Copie" : "Copier le diagnostic"}
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
              <dt className="opacity-70">URL</dt>
              <dd className="break-all" style={{ color: "var(--text-primary)" }}>
                {probeUrl}
              </dd>
              <dt className="opacity-70">Origine</dt>
              <dd style={{ color: "var(--text-primary)" }}>{origin}</dd>
              <dt className="opacity-70">Statut</dt>
              <dd style={{ color: "var(--text-primary)" }}>
                {probe.status}
                {probe.httpStatus !== undefined ? ` (HTTP ${probe.httpStatus})` : ""}
              </dd>
              {probe.error && (
                <>
                  <dt className="opacity-70">Erreur</dt>
                  <dd className="break-all" style={{ color: "var(--text-primary)" }}>
                    {probe.error}
                  </dd>
                </>
              )}
              <dt className="opacity-70">Modeles</dt>
              <dd style={{ color: "var(--text-primary)" }}>
                {liveModels.length > 0 ? liveModels.join(", ") : "(aucun)"}
              </dd>
            </dl>
            {recommendation && (
              <p
                className="rounded border px-2 py-1 text-[11px]"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface-1)",
                  color: "var(--text-primary)",
                }}
              >
                {recommendation}
              </p>
            )}
          </div>
        )}

        <SettingRow label="Activer l'IA" description="Active ou desactive tous les modules IA">
          <ToggleSwitch
            checked={ia.autoTagging || ia.autoClassify}
            onChange={(v) => updateIa({ autoTagging: v, autoClassify: v })}
          />
        </SettingRow>

        <SettingRow
          label="Hote Ollama"
          description={`Defaut: ${DEFAULT_OLLAMA_HOST}`}
        >
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onBlur={(e) => persistHost(e.target.value || DEFAULT_OLLAMA_HOST)}
            placeholder={DEFAULT_OLLAMA_HOST}
            className="w-56 rounded border px-2 py-1 text-sm"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-1)",
              color: "var(--text-primary)",
            }}
          />
        </SettingRow>

        <SettingRow label="Modele Ollama">
          <NativeSelect
            value={ia.ollamaModel}
            onChange={(v) => updateIa({ ollamaModel: v })}
            options={modelOptions}
          />
        </SettingRow>

        <SettingRow
          label="Seuil de confiance"
          description={`${Math.round(ia.confidenceThreshold * 100)}%`}
        >
          <RangeSlider
            min={0.1}
            max={1}
            step={0.05}
            value={ia.confidenceThreshold}
            onChange={(v) => updateIa({ confidenceThreshold: v })}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Fonctionnalites IA"
        description="Activez ou desactivez chaque module"
      >
        {AI_FEATURES.map(({ key, label, description }) => (
          <SettingRow key={key} label={label} description={description}>
            <ToggleSwitch
              checked={ia[key] as boolean}
              onChange={(v) => updateIa({ [key]: v })}
            />
          </SettingRow>
        ))}
        <SettingRow
          label="Generer automatiquement les titres de notes"
          description="Quand le titre est vide ou par defaut, Ollama propose un titre apres 2s d'inactivite"
        >
          <ToggleSwitch checked={autoTitle} onChange={toggleAutoTitle} />
        </SettingRow>
        <SettingRow
          label="Suggérer automatiquement des tags"
          description="Quand la note n'a aucun tag, Ollama propose 3 à 5 tags après 5s d'inactivité"
        >
          <ToggleSwitch checked={autoTag} onChange={toggleAutoTag} />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
