"use client";

/**
 * Gestes de triage au doigt (mobile), sur une ligne de la boîte comme sur le
 * fil ouvert :
 *   → vers la droite : archiver
 *   ← vers la gauche : supprimer (corbeille, annulable par le toast)
 * Un appui long (lignes seulement) ouvre la feuille d'actions complète.
 *
 * Détails qui comptent : le geste ne s'engage QUE s'il est franchement
 * horizontal (sinon on bloquerait le défilement vertical), les écouteurs sont
 * non-passifs pour pouvoir annuler le scroll une fois engagés, et le retour
 * animé est désactivé quand l'utilisateur a demandé moins d'animations.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Archive, Trash } from "@phosphor-icons/react";
import { haptic } from "@/lib/haptic";
import { prefersReducedMotion } from "@/lib/motion";

/** Distance à parcourir pour déclencher l'action au relâchement. */
const TRIGGER_PX = 88;
/** Distance minimale avant d'engager le geste (anti-faux positif). */
const ENGAGE_PX = 10;

export type SwipeAction = "archive" | "delete";

/** Un email large défile horizontalement : le doigt y appartient au contenu. */
function ownsHorizontalTouch(target: EventTarget | null, root: HTMLElement): boolean {
  for (let n = target instanceof Element ? target : null; n && n !== root; n = n.parentElement) {
    if (n instanceof HTMLElement && n.isContentEditable) return true;
    if (n.matches("input, textarea, select")) return true;
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

export function useSwipeGesture({
  onSwipe,
  onLongPress,
  disabled = false,
}: {
  onSwipe: (action: SwipeAction) => void;
  onLongPress?: () => void;
  disabled?: boolean;
}) {
  // Élément en state (ref callback) : la cible peut monter après le premier rendu.
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  // Le handler `touchend` lit la dernière position via une ref (l'état `dx` y serait périmé).
  const dxRef = useRef(0);
  dxRef.current = dx;

  useEffect(() => {
    if (!el || disabled) return undefined;

    let startX = 0;
    let startY = 0;
    let engaged = false;
    let decided = false;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelLongPress = () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      decided = true;
      engaged = false;
      if (!t || ownsHorizontalTouch(e.target, el)) return;
      startX = t.clientX;
      startY = t.clientY;
      decided = false;
      setAnimating(false);
      if (onLongPress) {
        longPressTimer = setTimeout(() => {
          cancelLongPress();
          haptic(15);
          onLongPress();
        }, 500);
      }
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const deltaX = t.clientX - startX;
      const deltaY = t.clientY - startY;
      if (!decided) {
        if (Math.abs(deltaX) < ENGAGE_PX && Math.abs(deltaY) < ENGAGE_PX) return;
        decided = true;
        engaged = Math.abs(deltaX) > Math.abs(deltaY);
        if (!engaged) cancelLongPress();
      }
      if (!engaged) return;
      cancelLongPress();
      e.preventDefault(); // écouteur non-passif : on prend la main sur le scroll
      // Résistance au-delà du seuil : on sent qu'on est « au bout ».
      const capped =
        Math.abs(deltaX) <= TRIGGER_PX
          ? deltaX
          : Math.sign(deltaX) * (TRIGGER_PX + (Math.abs(deltaX) - TRIGGER_PX) * 0.35);
      if ((Math.abs(capped) >= TRIGGER_PX) !== (Math.abs(dxRef.current) >= TRIGGER_PX)) haptic();
      setDx(capped);
    };

    const onEnd = () => {
      cancelLongPress();
      if (!engaged) return;
      const reached = Math.abs(dxRef.current) >= TRIGGER_PX;
      setAnimating(!prefersReducedMotion());
      if (reached) {
        const action: SwipeAction = dxRef.current > 0 ? "archive" : "delete";
        // On termine la sortie avant de remonter l'action : l'élément disparaît
        // dans le mouvement plutôt que de sauter.
        setDx(Math.sign(dxRef.current) * (el.offsetWidth || 320));
        setTimeout(() => {
          onSwipe(action);
          setDx(0);
          setAnimating(false);
        }, 160);
      } else {
        setDx(0);
      }
      engaged = false;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      cancelLongPress();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [el, disabled, onSwipe, onLongPress]);

  // Pas de transform au repos : il changerait le bloc conteneur des `fixed` descendants.
  const style: CSSProperties | undefined =
    dx !== 0 || animating
      ? {
          transform: `translateX(${dx}px)`,
          transition: animating ? "transform var(--sn-dur-2, 160ms) var(--sn-ease-out, ease-out)" : undefined,
          background: "var(--surface-0, var(--background))",
        }
      : undefined;

  return { ref: setEl, dx, style };
}

/** Fond révélé sous l'élément glissé ; à placer dans un parent `relative overflow-hidden`. */
export function SwipeBackdrop({ dx }: { dx: number }) {
  if (dx === 0) return null;
  const progress = Math.min(Math.abs(dx) / TRIGGER_PX, 1);
  const armed = Math.abs(dx) >= TRIGGER_PX;
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-between px-4"
      style={{
        background: `color-mix(in oklch, ${dx > 0 ? "var(--success)" : "var(--danger)"} ${Math.round(progress * 70)}%, transparent)`,
      }}
    >
      <span
        className="flex items-center gap-1.5 text-xs font-semibold"
        style={{ color: "var(--text-primary)", opacity: dx > 0 ? 1 : 0 }}
      >
        <Archive size={16} weight={armed ? "fill" : "regular"} /> Archiver
      </span>
      <span
        className="flex items-center gap-1.5 text-xs font-semibold"
        style={{ color: "var(--text-primary)", opacity: dx < 0 ? 1 : 0 }}
      >
        Supprimer <Trash size={16} weight={armed ? "fill" : "regular"} />
      </span>
    </div>
  );
}

export function SwipeableRow({
  children,
  onSwipe,
  onLongPress,
  /** Désactive le geste (ligne non triable : groupe, mode sélection…). */
  disabled = false,
  className = "relative overflow-hidden rounded-lg",
  innerClassName,
}: {
  children: ReactNode;
  onSwipe: (action: SwipeAction) => void;
  onLongPress?: () => void;
  disabled?: boolean;
  className?: string;
  innerClassName?: string;
}) {
  // L'état du geste vit ici : un glissement ne re-rend que ce wrapper, pas le parent.
  const swipe = useSwipeGesture({ onSwipe, onLongPress, disabled });

  return (
    <div ref={swipe.ref} className={className}>
      <SwipeBackdrop dx={swipe.dx} />
      <div className={innerClassName} style={swipe.style}>
        {children}
      </div>
    </div>
  );
}
