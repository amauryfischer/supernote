"use client";

/**
 * /pomodoro — minuteur Pomodoro avec alarme sonore.
 *
 * Modes :
 *   - "single" : sonne puis s'arrête à la fin du cycle.
 *   - "perma"  : sonne puis redémarre automatiquement jusqu'à arrêt manuel.
 *
 * Durée personnalisable (1 à 180 min). Alarme générée via WebAudio API
 * (pas de fichier externe à charger).
 */

import { AppShell, useMobileTitle } from "@/components/shell";
import { Button, Input } from "@heroui/react";
import { Pause, Play, Stop, Timer } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Mode = "single" | "perma";
type Status = "idle" | "running" | "paused" | "ringing";

const STORAGE_KEY = "supernote.pomodoro.config";

interface StoredConfig {
  minutes: number;
  mode: Mode;
}

function loadConfig(): StoredConfig {
  if (typeof window === "undefined") return { minutes: 25, mode: "single" };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { minutes: 25, mode: "single" };
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    const minutes = typeof parsed.minutes === "number" && parsed.minutes > 0 ? parsed.minutes : 25;
    const mode: Mode = parsed.mode === "perma" ? "perma" : "single";
    return { minutes, mode };
  } catch {
    return { minutes: 25, mode: "single" };
  }
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Alarme WebAudio — trois bips de 300 ms à 880 Hz, en boucle si `loop`. */
function useAlarm() {
  const ctxRef = useRef<AudioContext | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
    }
    if (ctxRef.current.state === "suspended") {
      void ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  /**
   * Déverrouille l'AudioContext via un geste utilisateur (Démarrer).
   * Sans ça, le navigateur bloque tout son joué depuis un timer.
   * On joue un son inaudible de 1 ms pour forcer l'état "running".
   */
  const unlock = useCallback(() => {
    const ctx = ensureCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.001);
    } catch {
      /* ignore */
    }
  }, [ensureCtx]);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const play = useCallback(
    (loop = false) => {
      const ctx = ensureCtx();
      if (!ctx) return;
      stop();

      let cancelled = false;
      const timers: number[] = [];
      let lastOsc: OscillatorNode | null = null;

      const beepOnce = (when: number) => {
        if (cancelled) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(0.4, when + 0.02);
        gain.gain.linearRampToValueAtTime(0, when + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(when);
        osc.stop(when + 0.32);
        lastOsc = osc;
      };

      const playSequence = () => {
        if (cancelled) return;
        const now = ctx.currentTime;
        beepOnce(now);
        beepOnce(now + 0.45);
        beepOnce(now + 0.9);
        if (loop) {
          const id = window.setTimeout(playSequence, 1600);
          timers.push(id);
        }
      };

      playSequence();

      stopRef.current = () => {
        cancelled = true;
        while (timers.length) window.clearTimeout(timers.pop()!);
        try {
          lastOsc?.stop();
        } catch {
          /* déjà arrêté */
        }
      };
    },
    [ensureCtx, stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { play, stop, unlock };
}

export default function PomodoroPage() {
  useMobileTitle("Pomodoro");

  const initial = useMemo(() => loadConfig(), []);
  const [minutes, setMinutes] = useState<number>(initial.minutes);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [status, setStatus] = useState<Status>("idle");
  const [remaining, setRemaining] = useState<number>(initial.minutes * 60);

  const alarm = useAlarm();
  const tickRef = useRef<number | null>(null);
  const endAtRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ minutes, mode }));
    } catch {
      /* ignore */
    }
  }, [minutes, mode]);

  useEffect(() => {
    if (status === "idle") {
      setRemaining(minutes * 60);
    }
  }, [minutes, status]);

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    if (endAtRef.current === null) return;
    const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
    setRemaining(left);
    if (left <= 0) {
      clearTick();
      endAtRef.current = null;
      setStatus("ringing");
      alarm.play(mode === "perma");
    }
  }, [alarm, clearTick, mode]);

  const start = useCallback(() => {
    if (minutes <= 0) return;
    alarm.unlock();
    const durationSec = status === "paused" ? remaining : minutes * 60;
    endAtRef.current = Date.now() + durationSec * 1000;
    setRemaining(durationSec);
    setStatus("running");
    clearTick();
    tickRef.current = window.setInterval(tick, 250);
  }, [alarm, clearTick, minutes, remaining, status, tick]);

  const pause = useCallback(() => {
    if (status !== "running") return;
    clearTick();
    if (endAtRef.current !== null) {
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setRemaining(left);
    }
    endAtRef.current = null;
    setStatus("paused");
  }, [clearTick, status]);

  const stop = useCallback(() => {
    clearTick();
    endAtRef.current = null;
    alarm.stop();
    setRemaining(minutes * 60);
    setStatus("idle");
  }, [alarm, clearTick, minutes]);

  // En perma : après ~4s d'alarme, relance un nouveau cycle.
  useEffect(() => {
    if (status !== "ringing" || mode !== "perma") return;
    const id = window.setTimeout(() => {
      alarm.stop();
      const durationSec = minutes * 60;
      endAtRef.current = Date.now() + durationSec * 1000;
      setRemaining(durationSec);
      setStatus("running");
      clearTick();
      tickRef.current = window.setInterval(tick, 250);
    }, 4000);
    return () => window.clearTimeout(id);
  }, [alarm, clearTick, minutes, mode, status, tick]);

  useEffect(() => () => clearTick(), [clearTick]);

  // Titre de l'onglet : reflète le timer pendant un cycle actif, restaure
  // le titre d'origine au démontage / arrêt.
  useEffect(() => {
    const original = document.title;
    if (status === "idle") {
      return () => {
        document.title = original;
      };
    }
    const prefix =
      status === "ringing" ? "🔔" : status === "paused" ? "⏸" : "⏱";
    document.title = `${prefix} ${formatTime(remaining)} — Pomodoro`;
    return () => {
      document.title = original;
    };
  }, [remaining, status]);

  const progress = useMemo(() => {
    const total = minutes * 60;
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, 1 - remaining / total));
  }, [minutes, remaining]);

  const inputsDisabled = status === "running" || status === "paused" || status === "ringing";
  const PRESETS = [5, 15, 25, 45, 60] as const;

  return (
    <AppShell>
      <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-8 px-6 py-10">
        <div className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
          <Timer size={20} />
          <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Pomodoro
          </h1>
        </div>

        <PomodoroRing
          progress={progress}
          label={formatTime(remaining)}
          ringing={status === "ringing"}
        />

        <div className="flex items-center gap-3">
          {status === "running" ? (
            <Button variant="primary" onPress={pause}>
              <Pause size={16} />
              Pause
            </Button>
          ) : (
            <Button
              variant="primary"
              onPress={start}
              isDisabled={status === "ringing" || minutes <= 0}
            >
              <Play size={16} />
              {status === "paused" ? "Reprendre" : "Démarrer"}
            </Button>
          )}
          <Button variant="secondary" onPress={stop} isDisabled={status === "idle"}>
            <Stop size={16} />
            Arrêter
          </Button>
        </div>

        <div
          className="grid w-full grid-cols-1 gap-4 rounded-xl border p-4 sm:grid-cols-2"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Durée (minutes)
            </span>
            <Input
              type="number"
              min={1}
              max={180}
              step={1}
              value={String(minutes)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0) {
                  setMinutes(Math.max(1, Math.min(180, Math.round(n))));
                }
              }}
              aria-label="Durée en minutes"
              disabled={inputsDisabled}
            />
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={minutes === preset ? "primary" : "ghost"}
                  onPress={() => setMinutes(preset)}
                  isDisabled={inputsDisabled}
                >
                  {preset}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Mode
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={mode === "single" ? "primary" : "ghost"}
                onPress={() => setMode("single")}
                isDisabled={inputsDisabled}
                fullWidth
              >
                1 cycle
              </Button>
              <Button
                size="sm"
                variant={mode === "perma" ? "primary" : "ghost"}
                onPress={() => setMode("perma")}
                isDisabled={inputsDisabled}
                fullWidth
              >
                Perma
              </Button>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {mode === "single"
                ? "Le minuteur s'arrête après un cycle ; l'alarme sonne une fois."
                : "Le minuteur enchaîne les cycles automatiquement (alarme entre chaque) jusqu'à arrêt manuel."}
            </p>
          </div>
        </div>

        {status === "ringing" && (
          <div
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
          >
            Cycle terminé — {mode === "perma" ? "redémarrage automatique…" : "alarme en cours"}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function PomodoroRing({
  progress,
  label,
  ringing,
}: {
  progress: number;
  label: string;
  ringing: boolean;
}) {
  const size = 240;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - progress);

  return (
    <div
      className={ringing ? "animate-pulse" : ""}
      style={{ width: size, height: size, position: "relative" }}
    >
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 250ms linear" }}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-5xl font-bold tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        {label}
      </div>
    </div>
  );
}
