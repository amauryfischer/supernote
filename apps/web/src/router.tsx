/**
 * Route table — replaces the Next.js file-system router.
 *
 * Each leaf imports the existing app/<route>/page.tsx default export
 * unchanged. We only flatten the URL -> component mapping here so
 * react-router-dom can handle navigation.
 *
 * Lazy-loaded routes use the `lazy: () => import(...)` form so each route
 * lands in its own chunk, mirroring the per-route bundling Next did
 * automatically. The shell (RootLayout) is loaded eagerly.
 */

import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./RootLayout";
import { RouteErrorBoundary } from "./components/error/ErrorBoundary";

// Lazy adapter: react-router v6 expects `lazy` to return `{ Component }` or
// `{ element }`. Our pages export a default function component — wrap once.
//
// The default-export type is loosened to `React.ComponentType<unknown>`
// because some pages still declare a Next-style `interface { params }`
// prop. At the SPA layer the props are always empty (we read params via
// react-router hooks), so the type mismatch is purely cosmetic.
type AnyPage = React.ComponentType<Record<string, never>>;

// Module-level guard so we don't reload-loop if chunks really are broken.
let didChunkReload = false;

/**
 * Wrap a route's dynamic import so a stale-chunk failure (Vite re-optimised
 * deps, dev server bounced, SW served an outdated index.html, etc.) doesn't
 * leave the user on the framework's "Unexpected Application Error" page.
 *
 * Symptom we want to absorb:
 *   `TypeError: Failed to fetch dynamically imported module: …/page.tsx`
 *
 * Strategy: detect that exact failure mode and force a single hard reload —
 * the fresh `index.html` carries up-to-date chunk URLs. We gate the reload
 * with a sessionStorage flag so an actually-broken build can't pin the user
 * in an infinite refresh loop.
 */
const lazyPage =
  (loader: () => Promise<{ default: React.ComponentType<never> | React.ComponentType<unknown> | React.ComponentType<Record<string, unknown>> }>) =>
  async () => {
    try {
      const mod = await loader();
      return { Component: mod.default as AnyPage };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isStaleChunk =
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /Importing a module script failed/i.test(msg) ||
        /error loading dynamically imported module/i.test(msg);
      if (isStaleChunk && typeof window !== "undefined" && !didChunkReload) {
        try {
          const KEY = "supernote.chunkReloadAt";
          const last = Number(sessionStorage.getItem(KEY) || 0);
          // Throttle: never reload more than once per 10 s — protects against
          // a genuinely broken build that would otherwise loop forever.
          if (Date.now() - last > 10_000) {
            sessionStorage.setItem(KEY, String(Date.now()));
            didChunkReload = true;
            window.location.reload();
            // Block the route from rendering its error UI while the reload kicks in.
            return { Component: (() => null) as AnyPage };
          }
        } catch {
          /* sessionStorage may be unavailable in privacy mode — fall through */
        }
      }
      throw err;
    }
  };

// `ReturnType<typeof createBrowserRouter>` references @remix-run/router
// which TS can't always re-export portably under pnpm's symlink layout.
// Tell it to skip the deep inference — `unknown` cast is fine since the
// only consumer is `<RouterProvider router={router} />`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const router: any = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      // ── Home (le Journal du jour — voir docs/superpowers/specs/2026-09-03-flux-journal-design.md) ──
      { index: true, lazy: lazyPage(() => import("./app/journal/page")) },

      // ── Notes ─────────────────────────────────────────────────────────
      { path: "notes", lazy: lazyPage(() => import("./app/notes/page")) },
      { path: "notes/:id", lazy: lazyPage(() => import("./app/notes/[id]/page")) },
      { path: "archive", lazy: lazyPage(() => import("./app/archive/page")) },

      // ── Mail (Gmail) ──────────────────────────────────────────────────
      { path: "mail", lazy: lazyPage(() => import("./app/mail/page")) },

      // ── Todos (added by parallel agent — keep entry alongside notes) ──
      { path: "todos", lazy: lazyPage(() => import("./app/todos/page")) },

      // ── Habitudes (jardin de pixels) ──────────────────────────────────
      { path: "habits", lazy: lazyPage(() => import("./app/habits/page")) },

      // ── Journal ───────────────────────────────────────────────────────
      { path: "journal", lazy: lazyPage(() => import("./app/journal/page")) },
      { path: "journal/:date", lazy: lazyPage(() => import("./app/journal/[date]/page")) },

      // ── Contacts ──────────────────────────────────────────────────────
      { path: "contacts", lazy: lazyPage(() => import("./app/contacts/page")) },
      { path: "contacts/nouveau", lazy: lazyPage(() => import("./app/contacts/nouveau/page")) },
      { path: "contacts/:id", lazy: lazyPage(() => import("./app/contacts/[id]/page")) },

      // ── Finance ───────────────────────────────────────────────────────
      // Section minimaliste réécrite from scratch après crash en boucle dans
      // l'ancien code. On garde uniquement le dashboard + la liste de comptes
      // + la page de détail ; les autres sous-routes (actifs, objectifs,
      // prêts, snapshots) seront ré-introduites une par une si besoin.
      { path: "finance", lazy: lazyPage(() => import("./app/finance/page")) },
      { path: "finance/comptes", lazy: lazyPage(() => import("./app/finance/comptes/page")) },
      { path: "finance/comptes/:id", lazy: lazyPage(() => import("./app/finance/comptes/[id]/page")) },
      { path: "finance/actifs", lazy: lazyPage(() => import("./app/finance/actifs/page")) },
      { path: "finance/actifs/:id", lazy: lazyPage(() => import("./app/finance/actifs/[id]/page")) },

      // ── Schemas ───────────────────────────────────────────────────────
      { path: "schemas", lazy: lazyPage(() => import("./app/schemas/page")) },
      { path: "schemas/nouveau", lazy: lazyPage(() => import("./app/schemas/nouveau/page")) },
      { path: "schemas/relations", lazy: lazyPage(() => import("./app/schemas/relations/page")) },
      { path: "schemas/:id", lazy: lazyPage(() => import("./app/schemas/[id]/page")) },

      // ── Bases (data view of an EntityType) ───────────────────────────
      { path: "bases/:typeId", lazy: lazyPage(() => import("./app/bases/[typeId]/page")) },

      // ── Routines ──────────────────────────────────────────────────────
      { path: "routines", lazy: lazyPage(() => import("./app/routines/page")) },
      { path: "routines/nouveau", lazy: lazyPage(() => import("./app/routines/nouveau/page")) },
      { path: "routines/:id", lazy: lazyPage(() => import("./app/routines/[id]/page")) },

      // ── Variables ─────────────────────────────────────────────────────────
      { path: "variables", lazy: lazyPage(() => import("./app/variables/page")) },
      { path: "variables/nouveau", lazy: lazyPage(() => import("./app/variables/nouveau/page")) },
      { path: "variables/:id", lazy: lazyPage(() => import("./app/variables/[id]/page")) },

      // ── AI Assistant (agentic chat with local Ollama) ────────────────
      { path: "ai", lazy: lazyPage(() => import("./app/ai/page")) },

      // ── Pomodoro ──────────────────────────────────────────────────────
      { path: "pomodoro", lazy: lazyPage(() => import("./app/pomodoro/page")) },

      // ── Misc top-level routes ────────────────────────────────────────
      { path: "tags", lazy: lazyPage(() => import("./app/tags/page")) },
      { path: "templates", lazy: lazyPage(() => import("./app/templates/page")) },
      { path: "recherche", lazy: lazyPage(() => import("./app/recherche/page")) },
      { path: "parametres", lazy: lazyPage(() => import("./app/parametres/page")) },
      { path: "capture", lazy: lazyPage(() => import("./app/capture/page")) },
      { path: "command-demo", lazy: lazyPage(() => import("./app/command-demo/page")) },
      { path: "dev/writing-surface", lazy: lazyPage(() => import("./app/dev/writing-surface/page")) },

      // ── 404 fallback ──────────────────────────────────────────────────
      // Returns the home page on unknown URLs. Replace with a dedicated
      // not-found component if/when one is added.
      { path: "*", lazy: lazyPage(() => import("./app/journal/page")) },
    ],
  },
]);
// Note : le flag `v7_startTransition` n'existe pas au niveau du routeur en
// 6.30.x — c'est une prop de <RouterProvider future={...}> (voir App.tsx).
