"use client";

/**
 * usePullToRefresh — « tirer pour rafraîchir » sur un conteneur scrollable.
 *
 * Geste attendu par réflexe sur mobile, et jusqu'ici absent : la seule façon de
 * resynchroniser la boîte était de changer d'onglet. Le geste ne s'arme que
 * lorsque le conteneur est DÉJÀ tout en haut, et n'entre en action que si le
 * mouvement est franchement vertical — sinon il volerait les glissements de
 * triage horizontaux.
 *
 * Renvoie la distance de traction courante (px) et l'état de rafraîchissement,
 * à l'appelant d'en faire un indicateur.
 */

import { useEffect, useRef, useState, type RefObject } from "react";

/** Traction nécessaire pour déclencher le rafraîchissement. */
const TRIGGER_PX = 72;
/** Traction maximale affichée (au-delà, la résistance augmente). */
const MAX_PX = 110;

export function usePullToRefresh(
  scrollRef: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown> | void,
  enabled: boolean,
): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);
  pullRef.current = pull;
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return undefined;

    let startY = 0;
    let armed = false;
    let engaged = false;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startY = t.clientY;
      // Armé seulement si on part du tout début de la liste.
      armed = el.scrollTop <= 0 && !refreshingRef.current;
      engaged = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!armed) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - startY;
      if (dy <= 0) {
        if (engaged) setPull(0);
        engaged = false;
        return;
      }
      if (!engaged && dy < 8) return;
      engaged = true;
      e.preventDefault();
      // Résistance progressive : la traction ralentit au fur et à mesure.
      const damped = dy <= TRIGGER_PX ? dy : TRIGGER_PX + (dy - TRIGGER_PX) * 0.4;
      setPull(Math.min(damped, MAX_PX));
    };

    const onEnd = () => {
      if (!engaged) return;
      engaged = false;
      if (pullRef.current >= TRIGGER_PX) {
        setRefreshing(true);
        setPull(TRIGGER_PX / 2);
        void Promise.resolve(onRefreshRef.current()).finally(() => {
          setRefreshing(false);
          setPull(0);
        });
      } else {
        setPull(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scrollRef, enabled]);

  return { pull, refreshing };
}
