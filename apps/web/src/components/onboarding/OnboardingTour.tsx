"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { X, ArrowLeft, ArrowRight } from "@phosphor-icons/react";

const STORAGE_KEY = "supernote.onboarding.completed";

interface TourStep {
  selector: string;
  title: string;
  description: string;
  position: "bottom" | "right" | "top" | "left";
}

const STEPS: TourStep[] = [
  {
    selector: "[data-tour='writing-surface']",
    title: "Commence par taper ici",
    description: "La surface d'écriture est ton espace de capture rapide. Écris n'importe quoi.",
    position: "bottom",
  },
  {
    selector: "[data-tour='sidebar-nav']",
    title: "Toutes tes données ici",
    description: "Notes, Contacts, Finance… toute ta connaissance organisée dans la barre latérale.",
    position: "right",
  },
  {
    selector: "[data-tour='command-palette-btn']",
    title: "Recherche et commandes rapides",
    description: "Appuie sur ⌘K pour ouvrir la palette de commandes et naviguer à la vitesse de la pensée.",
    position: "bottom",
  },
  {
    selector: "[data-tour='new-btn']",
    title: "Crée n'importe quoi",
    description: "Le bouton + Nouveau crée notes, contacts, canvas, et plus encore en un clic.",
    position: "bottom",
  },
  {
    selector: "[data-tour='settings-link']",
    title: "Personnalise tout",
    description: "Adapte Supernote à ton workflow : thème, raccourcis, intégrations, vault.",
    position: "right",
  },
];

interface TooltipPosition {
  top: number;
  left: number;
}

function getTooltipPosition(
  targetRect: DOMRect,
  position: TourStep["position"],
  tooltipWidth = 280,
  tooltipHeight = 140,
): TooltipPosition {
  const gap = 12;
  let raw: TooltipPosition;
  switch (position) {
    case "bottom":
      raw = {
        top: targetRect.bottom + gap,
        left: targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
      };
      break;
    case "right":
      raw = {
        top: targetRect.top + targetRect.height / 2 - tooltipHeight / 2,
        left: targetRect.right + gap,
      };
      break;
    case "top":
      raw = {
        top: targetRect.top - tooltipHeight - gap,
        left: targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
      };
      break;
    case "left":
      raw = {
        top: targetRect.top + targetRect.height / 2 - tooltipHeight / 2,
        left: targetRect.left - tooltipWidth - gap,
      };
      break;
  }
  // Ramené dans l'écran des DEUX côtés : seul le bord gauche était borné, si
  // bien qu'une cible à droite ou en bas poussait la bulle hors du viewport —
  // systématique sur une largeur de téléphone (la bulle fait 280px).
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - tooltipWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - tooltipHeight - margin);
  return {
    top: Math.min(Math.max(margin, raw.top), maxTop),
    left: Math.min(Math.max(margin, raw.left), maxLeft),
  };
}

export function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition>({ top: 0, left: 0 });
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const positionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Étapes réellement présentes à l'écran. Les ancres `data-tour` vivent sur
  // le shell : celles qui n'ont pas d'équivalent sur la surface courante sont
  // écartées, sinon leur bulle resterait figée en {0,0} à désigner du vide.
  const [steps, setSteps] = useState<TourStep[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const done = localStorage.getItem(STORAGE_KEY);
    if (done) return;
    // Short delay so the page renders first
    const t = setTimeout(() => {
      const available = STEPS.filter((s) => document.querySelector(s.selector));
      // Aucune ancre présente (shell mobile, route sans barre latérale…) : on
      // n'ouvre pas un tour qui ne pourrait montrer rien.
      if (available.length === 0) return;
      setSteps(available);
      setStep(0);
      setActive(true);
    }, 600);
    return () => clearTimeout(t);
  }, []);

  const updatePosition = (stepIndex: number) => {
    const currentStep = steps[stepIndex];
    if (!currentStep) return;
    const target = document.querySelector(currentStep.selector);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setHighlightRect(rect);
    setTooltipPos(getTooltipPosition(rect, currentStep.position));
  };

  useEffect(() => {
    if (!active) return;
    // Slight delay to allow DOM to settle
    positionTimerRef.current = setTimeout(() => updatePosition(step), 50);
    return () => {
      if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
    };
  }, [active, step]);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setActive(false);
  };

  const goNext = () => {
    if (step < steps.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  };

  const goPrev = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  if (!active) return null;

  const currentStep = steps[step];
  if (!currentStep) return null;
  const isLast = step === steps.length - 1;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[var(--z-tour)]"
        style={{ backgroundColor: "rgba(0,0,0,0.45)", pointerEvents: "all" }}
        onClick={dismiss}
      />

      {/* Highlight ring around target */}
      {highlightRect && (
        <div
          className="pointer-events-none fixed z-[calc(var(--z-tour)+1)] rounded-md"
          style={{
            top: highlightRect.top - 4,
            left: highlightRect.left - 4,
            width: highlightRect.width + 8,
            height: highlightRect.height + 8,
            boxShadow: "0 0 0 2px var(--accent), 0 0 0 6px rgba(255,255,255,0.12)",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="fixed z-[calc(var(--z-tour)+2)] w-[280px] rounded-xl border p-4 shadow-2xl"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          backgroundColor: "var(--surface-0)",
          borderColor: "var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            {step + 1}/{steps.length}
          </span>
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            onPress={dismiss}
            className="h-5 w-5 min-h-0 min-w-0 rounded"
            style={{ color: "var(--text-muted)" }}
            aria-label="Fermer le tour"
          >
            <X size={12} />
          </Button>
        </div>

        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {currentStep.title}
        </h3>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {currentStep.description}
        </p>

        {/* Progress dots */}
        <div className="mt-3 flex items-center gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === step ? 16 : 6,
                backgroundColor: i === step ? "var(--accent)" : "var(--surface-3)",
              }}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onPress={dismiss}
            className="text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Ignorer
          </Button>
          <div className="flex items-center gap-1.5">
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                onPress={goPrev}
                className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium"
                style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)" }}
              >
                <ArrowLeft size={11} />
                Précédent
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onPress={goNext}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              {isLast ? "Terminer" : "Suivant"}
              {!isLast && <ArrowRight size={11} />}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
