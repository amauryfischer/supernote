/**
 * Top-level application component — wires the router to the existing
 * provider stack that `RootLayout` previously hosted in Next's `app/layout.tsx`.
 */

import { RouterProvider } from "react-router-dom";
import { router } from "./router";

export function App() {
  // v7_startTransition : opt-in v7 (stoppe le warning console, prépare la
  // migration) — tous les state updates router passent par React.startTransition.
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}
