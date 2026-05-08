/**
 * Top-level application component — wires the router to the existing
 * provider stack that `RootLayout` previously hosted in Next's `app/layout.tsx`.
 */

import { RouterProvider } from "react-router-dom";
import { router } from "./router";

export function App() {
  return <RouterProvider router={router} />;
}
