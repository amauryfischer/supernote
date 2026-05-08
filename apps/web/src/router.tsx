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

// Lazy adapter: react-router v6 expects `lazy` to return `{ Component }` or
// `{ element }`. Our pages export a default function component — wrap once.
//
// The default-export type is loosened to `React.ComponentType<unknown>`
// because some pages still declare a Next-style `interface { params }`
// prop. At the SPA layer the props are always empty (we read params via
// react-router hooks), so the type mismatch is purely cosmetic.
type AnyPage = React.ComponentType<Record<string, never>>;

const lazyPage =
  (loader: () => Promise<{ default: React.ComponentType<never> | React.ComponentType<unknown> | React.ComponentType<Record<string, unknown>> }>) =>
  async () => {
    const mod = await loader();
    return { Component: mod.default as AnyPage };
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
    children: [
      // ── Home ──────────────────────────────────────────────────────────
      { index: true, lazy: lazyPage(() => import("./app/page")) },

      // ── Notes ─────────────────────────────────────────────────────────
      { path: "notes", lazy: lazyPage(() => import("./app/notes/page")) },
      { path: "notes/:id", lazy: lazyPage(() => import("./app/notes/[id]/page")) },

      // ── Todos (added by parallel agent — keep entry alongside notes) ──
      { path: "todos", lazy: lazyPage(() => import("./app/todos/page")) },

      // ── Journal ───────────────────────────────────────────────────────
      { path: "journal", lazy: lazyPage(() => import("./app/journal/page")) },
      { path: "journal/:date", lazy: lazyPage(() => import("./app/journal/[date]/page")) },

      // ── Contacts ──────────────────────────────────────────────────────
      { path: "contacts", lazy: lazyPage(() => import("./app/contacts/page")) },
      { path: "contacts/nouveau", lazy: lazyPage(() => import("./app/contacts/nouveau/page")) },
      { path: "contacts/:id", lazy: lazyPage(() => import("./app/contacts/[id]/page")) },

      // ── Projets ───────────────────────────────────────────────────────
      { path: "projets", lazy: lazyPage(() => import("./app/projets/page")) },
      { path: "projets/:id", lazy: lazyPage(() => import("./app/projets/[id]/page")) },

      // ── Finance ───────────────────────────────────────────────────────
      { path: "finance", lazy: lazyPage(() => import("./app/finance/page")) },
      { path: "finance/comptes", lazy: lazyPage(() => import("./app/finance/comptes/page")) },
      { path: "finance/comptes/:id", lazy: lazyPage(() => import("./app/finance/comptes/[id]/page")) },
      { path: "finance/actifs", lazy: lazyPage(() => import("./app/finance/actifs/page")) },
      { path: "finance/actifs/:id", lazy: lazyPage(() => import("./app/finance/actifs/[id]/page")) },
      { path: "finance/objectifs", lazy: lazyPage(() => import("./app/finance/objectifs/page")) },
      { path: "finance/objectifs/:id", lazy: lazyPage(() => import("./app/finance/objectifs/[id]/page")) },
      { path: "finance/prets", lazy: lazyPage(() => import("./app/finance/prets/page")) },
      { path: "finance/prets/:id", lazy: lazyPage(() => import("./app/finance/prets/[id]/page")) },
      { path: "finance/snapshots", lazy: lazyPage(() => import("./app/finance/snapshots/page")) },
      { path: "finance/snapshots/:id", lazy: lazyPage(() => import("./app/finance/snapshots/[id]/page")) },

      // ── Schemas ───────────────────────────────────────────────────────
      { path: "schemas", lazy: lazyPage(() => import("./app/schemas/page")) },
      { path: "schemas/nouveau", lazy: lazyPage(() => import("./app/schemas/nouveau/page")) },
      { path: "schemas/relations", lazy: lazyPage(() => import("./app/schemas/relations/page")) },
      { path: "schemas/:id", lazy: lazyPage(() => import("./app/schemas/[id]/page")) },

      // ── Vues ──────────────────────────────────────────────────────────
      { path: "vues", lazy: lazyPage(() => import("./app/vues/page")) },
      { path: "vues/nouvelle", lazy: lazyPage(() => import("./app/vues/nouvelle/page")) },
      { path: "vues/:id", lazy: lazyPage(() => import("./app/vues/[id]/page")) },

      // ── Routines ──────────────────────────────────────────────────────
      { path: "routines", lazy: lazyPage(() => import("./app/routines/page")) },
      { path: "routines/nouveau", lazy: lazyPage(() => import("./app/routines/nouveau/page")) },
      { path: "routines/:id", lazy: lazyPage(() => import("./app/routines/[id]/page")) },

      // ── Canvas ────────────────────────────────────────────────────────
      { path: "canvas", lazy: lazyPage(() => import("./app/canvas/page")) },
      { path: "canvas/:id", lazy: lazyPage(() => import("./app/canvas/[id]/page")) },

      // ── Misc top-level routes ────────────────────────────────────────
      { path: "graph", lazy: lazyPage(() => import("./app/graph/page")) },
      { path: "tags", lazy: lazyPage(() => import("./app/tags/page")) },
      { path: "templates", lazy: lazyPage(() => import("./app/templates/page")) },
      { path: "recherche", lazy: lazyPage(() => import("./app/recherche/page")) },
      { path: "parametres", lazy: lazyPage(() => import("./app/parametres/page")) },
      { path: "capture", lazy: lazyPage(() => import("./app/capture/page")) },
      { path: "command-demo", lazy: lazyPage(() => import("./app/command-demo/page")) },

      // ── 404 fallback ──────────────────────────────────────────────────
      // Returns the home page on unknown URLs. Replace with a dedicated
      // not-found component if/when one is added.
      { path: "*", lazy: lazyPage(() => import("./app/page")) },
    ],
  },
]);
