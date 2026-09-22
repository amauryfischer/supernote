import "../globals.css";
import { createRoot } from "react-dom/client";
import { ThemeProvider, ToastProvider } from "@supernote/ui";
import { ShareApp } from "./ShareApp";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="light" storageKey="supernote-theme">
    <ToastProvider>
      <ShareApp slug={decodeURIComponent(window.location.pathname.replace(/^\/s\//, "").split("/")[0] ?? "")} />
    </ToastProvider>
  </ThemeProvider>,
);
