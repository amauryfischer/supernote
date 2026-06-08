import { useEffect, useRef, useState } from "react";
import { createSmoothScalar, type SmoothScalar, type SmoothScalarOptions } from "./smoothScalar";

/**
 * React wrapper around {@link createSmoothScalar}: smoothly animates `target`
 * and returns the current interpolated value, re-rendering only while in motion
 * (the engine suspends once settled). Use for value-driven motion — animated
 * counters, smooth progress bars, follow positions. For hot/high-frequency
 * surfaces prefer the imperative engine writing straight to a ref.
 *
 * The first `target` is adopted instantly (no glide in from 0).
 */
export function useSmoothValue(target: number, options?: SmoothScalarOptions): number {
  const [value, setValue] = useState(target);
  const engineRef = useRef<SmoothScalar | null>(null);

  if (engineRef.current === null) {
    engineRef.current = createSmoothScalar((v) => setValue(v), {
      ...options,
      initial: target,
    });
  }

  useEffect(() => {
    engineRef.current?.setTarget(target);
  }, [target]);

  useEffect(() => () => engineRef.current?.stop(), []);

  return value;
}
