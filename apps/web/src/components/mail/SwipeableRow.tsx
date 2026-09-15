"use client";

/**
 * SwipeableRow — gestes de triage au doigt sur une ligne de la boîte.
 *
 * Sur mobile, le triage passait obligatoirement par l'ouverture du fil : c'est
 * un aller-retour par email. Ici, un glissement suffit :
 *   → vers la droite : archiver
 *   ← vers la gauche : reporter (ouvre le choix d'échéance)
 * Un appui long ouvre la feuille d'actions complète.
 *
 * Détails qui comptent : le geste ne s'engage QUE s'il est franchement
 * horizontal (sinon on bloquerait le défilement vertical), les écouteurs sont
 * non-passifs pour pouvoir annuler le scroll une fois engagés, et le retour
 * animé est désactivé quand l'utilisateur a demandé moins d'animations.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Clock } from "@phosphor-icons/react";
import { prefersReducedMotion } from "@/lib/motion";

/** Distance à parcourir pour déclencher l'action au relâchement. */
const TRIGGER_PX = 88;
/** Distance minimale avant d'engager le geste (anti-faux positif). */
const ENGAGE_PX = 10;

export type SwipeAction = "archive" | "snooze";

export function SwipeableRow({
  children,
  onSwipe,
  onLongPress,
  /** Désactive le geste (ligne non triable : groupe, mode sélection…). */
  disabled = false,
}: {
  children: ReactNode;
  onSwipe: (action: SwipeAction) => void;
  onLongPress?: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  // Le handler `touchend` est installé une fois pour toutes : il lit la dernière
  // position via une ref (l'état `dx` y serait périmé).
  const dxRef = useRef(0);
  dxRef.current = dx;

  useEffect(() => {
    const el = ref.current;
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
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      engaged = false;
      decided = false;
      setAnimating(false);
      if (onLongPress) {
        longPressTimer = setTimeout(() => {
          cancelLongPress();
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
        // Geste franchement horizontal → triage ; sinon on laisse défiler.
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
      setDx(capped);
    };

    const onEnd = () => {
      cancelLongPress();
      if (!engaged) return;
      const reached = Math.abs(dxRef.current) >= TRIGGER_PX;
      setAnimating(!prefersReducedMotion());
      if (reached) {
        const action: SwipeAction = dxRef.current > 0 ? "archive" : "snooze";
        // On termine la sortie avant de remonter l'action : la ligne disparaît
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
  }, [disabled, onSwipe, onLongPress]);

  if (disabled) return <>{children}</>;

  const progress = Math.min(Math.abs(dx) / TRIGGER_PX, 1);
  const armed = Math.abs(dx) >= TRIGGER_PX;

  return (
    <div ref={ref} className="relative overflow-hidden rounded-lg">
      {/* Fonds révélés par le glissement. */}
      {dx !== 0 && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-between px-4"
          style={{
            background:
              dx > 0
                ? `color-mix(in oklch, var(--success) ${Math.round(progress * 70)}%, transparent)`
                : `color-mix(in oklch, #f5b300 ${Math.round(progress * 70)}%, transparent)`,
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
            Reporter <Clock size={16} weight={armed ? "fill" : "regular"} />
          </span>
        </div>
      )}
      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: animating ? "transform var(--sn-dur-2, 160ms) var(--sn-ease-out, ease-out)" : undefined,
          background: dx !== 0 ? "var(--surface-0, var(--background))" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
