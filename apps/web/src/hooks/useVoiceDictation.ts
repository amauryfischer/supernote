"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Web Speech API — typages locaux ─────────────────────────────────────────
//
// `SpeechRecognition` n'est pas (ou mal) typé dans lib.dom selon la version de
// TypeScript, et `webkitSpeechRecognition` ne l'est jamais. On déclare donc les
// formes minimales dont on a besoin — sans aucun `any`. L'accès au constructeur
// se fait via un narrowing `unknown` plutôt qu'une augmentation globale de
// `Window` : ça évite tout conflit « Subsequent property declarations must have
// the same type » avec une éventuelle déclaration présente dans lib.dom.

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoiceDictationOptions {
  /** Langue de reconnaissance (BCP-47). Défaut : `fr-FR`. */
  lang?: string;
  /**
   * Appelé une seule fois par segment finalisé (jamais pour l'interim). C'est
   * ce texte-là que l'appelant insère dans le document.
   */
  onFinalSegment?: (text: string) => void;
  /** Appelé quand la reconnaissance démarre réellement. */
  onStart?: () => void;
  /**
   * Appelé quand la dictée se termine pour de bon (stop utilisateur, erreur
   * fatale, ou démontage) — PAS lors des redémarrages automatiques après un
   * silence. Sert à finaliser côté appelant (ex. clôturer l'insertion).
   */
  onEnd?: () => void;
  /** Appelé sur chaque erreur (`not-allowed`, `no-speech`, `network`, …). */
  onError?: (error: string) => void;
}

export interface VoiceDictation {
  /** La reconnaissance écoute actuellement. */
  listening: boolean;
  /** Transcription provisoire (non finalisée) — à afficher, pas à insérer. */
  interim: string;
  /** Démarre l'écoute. No-op si déjà en cours ou non supporté. */
  start: () => void;
  /** Arrête proprement l'écoute (déclenche `onEnd`). */
  stop: () => void;
  /** L'API Web Speech est disponible dans ce navigateur. */
  supported: boolean;
}

/**
 * Dictée vocale temps réel via la Web Speech API du navigateur — zéro
 * dépendance, zéro backend. Accumule les segments finaux (émis une seule fois
 * chacun via `onFinalSegment`) et expose la transcription provisoire pour un
 * affichage live. Redémarre automatiquement après les coupures de silence de
 * Chrome pour une dictée réellement continue ; ne relance pas sur erreur fatale
 * (micro refusé / absent). Nettoyage complet au démontage.
 */
export function useVoiceDictation(options: UseVoiceDictationOptions = {}): VoiceDictation {
  const { lang = "fr-FR" } = options;

  // Callbacks lus via refs → l'appelant peut passer des closures fraîches à
  // chaque render sans réinitialiser la reconnaissance.
  const onFinalSegmentRef = useRef(options.onFinalSegment);
  const onStartRef = useRef(options.onStart);
  const onEndRef = useRef(options.onEnd);
  const onErrorRef = useRef(options.onError);
  onFinalSegmentRef.current = options.onFinalSegment;
  onStartRef.current = options.onStart;
  onEndRef.current = options.onEnd;
  onErrorRef.current = options.onError;

  const [supported] = useState<boolean>(() => getSpeechRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const runningRef = useRef(false);
  // Fin volontaire (stop() / erreur fatale / unmount) → pas de redémarrage auto.
  const manualStopRef = useRef(false);
  const mountedRef = useRef(true);
  // Index du dernier résultat déjà émis comme final, PAR session. Empêche qu'un
  // même segment final soit inséré deux fois (interim → final → re-render).
  const lastFinalIndexRef = useRef(-1);

  const langRef = useRef(lang);
  langRef.current = lang;

  const ensureRecognition = useCallback((): SpeechRecognitionLike | null => {
    if (recognitionRef.current) return recognitionRef.current;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return null;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = langRef.current;

    rec.onstart = () => {
      runningRef.current = true;
      if (mountedRef.current) setListening(true);
      onStartRef.current?.();
    };

    rec.onresult = (event) => {
      let interimText = "";
      // On balaie TOUS les résultats et on n'émet un final que si son index
      // dépasse le dernier déjà émis → chaque phrase est insérée exactement une
      // fois, sans dépendre de la fiabilité de `resultIndex`.
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          if (i > lastFinalIndexRef.current) {
            lastFinalIndexRef.current = i;
            const finalText = transcript.trim();
            if (finalText) onFinalSegmentRef.current?.(finalText);
          }
        } else {
          interimText += transcript;
        }
      }
      if (mountedRef.current) setInterim(interimText);
    };

    rec.onerror = (event) => {
      onErrorRef.current?.(event.error);
      // Erreurs fatales → pas de relance ; `onend` clôturera proprement.
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "audio-capture"
      ) {
        manualStopRef.current = true;
      }
      // `no-speech` / `aborted` / `network` : transitoires → `onend` décide.
    };

    rec.onend = () => {
      runningRef.current = false;
      // Fin voulue (ou composant démonté) → on clôt la session.
      if (manualStopRef.current || !mountedRef.current) {
        if (mountedRef.current) {
          setListening(false);
          setInterim("");
        }
        onEndRef.current?.();
        return;
      }
      // Fin inattendue (silence, coupure Chrome) alors qu'on veut continuer →
      // nouvelle session : `results` repart de zéro, donc on ré-arme l'index.
      lastFinalIndexRef.current = -1;
      try {
        rec.start();
      } catch {
        if (mountedRef.current) {
          setListening(false);
          setInterim("");
        }
        onEndRef.current?.();
      }
    };

    recognitionRef.current = rec;
    return rec;
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    const rec = ensureRecognition();
    if (!rec) return;
    rec.lang = langRef.current;
    manualStopRef.current = false;
    lastFinalIndexRef.current = -1;
    setInterim("");
    try {
      rec.start();
    } catch {
      // `start()` lève si déjà démarré — l'état est alors déjà cohérent.
    }
  }, [ensureRecognition]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    manualStopRef.current = true;
    try {
      rec.stop();
    } catch {
      /* déjà arrêté */
    }
  }, []);

  // Nettoyage : coupe le micro et débranche les handlers pour éviter tout
  // setState après démontage.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const rec = recognitionRef.current;
      if (!rec) return;
      manualStopRef.current = true;
      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null; // évite un setState / un redémarrage post-unmount
      try {
        rec.abort();
      } catch {
        /* déjà arrêté */
      }
    };
  }, []);

  return { listening, interim, start, stop, supported };
}
