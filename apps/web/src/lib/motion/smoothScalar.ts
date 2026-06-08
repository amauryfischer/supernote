import { prefersReducedMotion } from "./prefersReducedMotion";

export interface SmoothScalarOptions {
  /** Smoothing time constant (ms): the value covers ~63% of the remaining
   *  distance every τ (~95% in 3τ). 35 ≈ the smooth caret's glide; larger is
   *  slower / more deliberate. */
  tau?: number;
  /** Snap-and-suspend threshold. Below this remaining delta the value snaps to
   *  target and the rAF loop stops (an idle scalar costs zero frames). */
  epsilon?: number;
  /** Starting value (defaults to 0). Set this to the initial target so the
   *  scalar doesn't glide in from 0 on mount. */
  initial?: number;
}

export interface SmoothScalar {
  /** Glide toward `v`, starting the loop if idle. */
  setTarget(v: number): void;
  /** Teleport to `v` with no animation (re-appearing from a stale spot). */
  jumpTo(v: number): void;
  /** Current interpolated value. */
  readonly value: number;
  /** Stop the loop and release the rAF. */
  stop(): void;
}

const MAX_DT = 50; // clamp tab-switch / GC gaps so the value doesn't leap

/**
 * Imperative exponential-smoothing scalar — the engine behind the smooth caret
 * (SmoothCaret.tsx), generalized for any value-driven motion. Frame-rate
 * independent (time-based `cur += (target - cur) * (1 - e^(-dt/τ))`),
 * self-suspends when settled, and collapses to instant under reduced-motion.
 *
 * `onTick(value)` fires each animated frame — drive DOM/refs from it directly
 * for hot surfaces (avoid per-frame React state).
 */
export function createSmoothScalar(
  onTick: (value: number) => void,
  options: SmoothScalarOptions = {},
): SmoothScalar {
  const tau = options.tau ?? 35;
  const epsilon = options.epsilon ?? 0.4;
  let cur = options.initial ?? 0;
  let target = cur;
  let raf: number | null = null;
  let last = 0;

  const loop = (t: number) => {
    raf = null;
    const dt = last ? Math.min(t - last, MAX_DT) : 16.7;
    last = t;
    const k = 1 - Math.exp(-dt / tau);
    cur += (target - cur) * k;
    if (Math.abs(target - cur) < epsilon) {
      cur = target;
      onTick(cur);
      last = 0;
      return;
    }
    onTick(cur);
    raf = requestAnimationFrame(loop);
  };

  const kick = () => {
    if (raf === null) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  };

  return {
    setTarget(v) {
      target = v;
      if (prefersReducedMotion()) {
        cur = v;
        if (raf !== null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
        onTick(cur);
        return;
      }
      if (Math.abs(target - cur) >= epsilon) kick();
    },
    jumpTo(v) {
      cur = v;
      target = v;
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      onTick(cur);
    },
    get value() {
      return cur;
    },
    stop() {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    },
  };
}
