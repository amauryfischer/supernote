/**
 * Entry point — replaces the Next.js bootstrapping pipeline.
 *
 * Vite serves this file from `index.html` via a `<script type="module">`.
 * Everything below executes in the browser only — no SSR pass.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installFreezeWatchdog } from "./lib/diagnostics/freeze-watchdog";
import "./globals.css";

// Capture des indices sur les freezes du thread principal (figé/tactile mort)
// pour diagnostiquer un hang intermittent en prod. Installé avant React pour
// dater la session au plus tôt. Cf. lib/diagnostics/freeze-watchdog.ts.
installFreezeWatchdog();

// Dev-only: React 19's DevTools render-timings instrumentation calls
// performance.measure() with a structured-cloneable `detail` that occasionally
// contains non-cloneable values (worker handles, FSA handles wired through
// context). When that throws DataCloneError, the renderer commit phase
// crashes and the tab freezes. Neutralise the measure call entirely in dev —
// we don't rely on render-timing markers anywhere in the app.
if (import.meta.env.DEV && typeof performance !== "undefined" && performance.measure) {
  performance.measure = function noopMeasure() {
    return {} as PerformanceMeasure;
  } as Performance["measure"];
}

const container = document.getElementById("root");
if (!container) {
  throw new Error('Root element <div id="root"></div> not found in index.html');
}

const root = createRoot(container);

// StrictMode is intentionally disabled to mirror the previous Next.js
// `reactStrictMode: false` setting — double-renders inflate perceived
// latency in dev (especially noticeable inside the canvas / editor).
const ENABLE_STRICT_MODE = false;

root.render(
  ENABLE_STRICT_MODE ? (
    <StrictMode>
      <App />
    </StrictMode>
  ) : (
    <App />
  ),
);
