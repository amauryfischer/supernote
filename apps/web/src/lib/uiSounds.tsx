"use client";

/**
 * Sons d'interface synthétisés (WebAudio, zéro asset). Désactivés par
 * défaut — gouvernés par Paramètres → Notifications → "sounds".
 *
 * Les producteurs (éditeur, save) ne savent rien du réglage : ils émettent
 * un CustomEvent "supernote:ui-sound" {kind}; le <UiSoundBridge/> monté au
 * root écoute et joue uniquement si le réglage est actif. L'AudioContext
 * est créé paresseusement au premier son — toujours suite à un geste
 * utilisateur (check, save), donc jamais bloqué par l'autoplay policy.
 */

import { useEffect } from "react";
import { useSettings } from "@/components/settings/SettingsContext";

export type UiSoundKind = "check" | "celebrate" | "save";

let sharedCtx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  try {
    sharedCtx ??= new AudioContext();
    if (sharedCtx.state === "suspended") void sharedCtx.resume();
    return sharedCtx;
  } catch {
    return null;
  }
}

/** Une note courte avec enveloppe attack/decay douce (pas de clic sec). */
function tone(
  freq: number,
  startAt: number,
  duration: number,
  gainPeak = 0.07,
  type: OscillatorType = "sine",
) {
  const ac = audioCtx();
  if (!ac) return;
  const t = ac.currentTime + startAt;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(gainPeak, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export function playUiSound(kind: UiSoundKind) {
  switch (kind) {
    case "check":
      // Tick montant — bref et discret.
      tone(880, 0, 0.09);
      tone(1318.5, 0.05, 0.12, 0.05);
      break;
    case "save":
      // Simple confirmation feutrée.
      tone(660, 0, 0.07, 0.035);
      break;
    case "celebrate":
      // Petit arpège majeur C5-E5-G5.
      tone(523.25, 0, 0.15);
      tone(659.25, 0.09, 0.15);
      tone(783.99, 0.18, 0.24);
      break;
  }
}

/** Pont événement → son, monté une fois au root (voir RootLayout). */
export function UiSoundBridge() {
  const { settings } = useSettings();
  const enabled = settings.notifications.sounds;

  useEffect(() => {
    if (!enabled) return;
    const onSound = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: UiSoundKind }>).detail?.kind;
      if (kind === "check" || kind === "celebrate" || kind === "save") {
        playUiSound(kind);
      }
    };
    document.addEventListener("supernote:ui-sound", onSound);
    return () => document.removeEventListener("supernote:ui-sound", onSound);
  }, [enabled]);

  return null;
}
