/**
 * Entry point — replaces the Next.js bootstrapping pipeline.
 *
 * Vite serves this file from `index.html` via a `<script type="module">`.
 * Everything below executes in the browser only — no SSR pass.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./globals.css";

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
