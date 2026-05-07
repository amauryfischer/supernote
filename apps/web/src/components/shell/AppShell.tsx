"use client";

import { RightPanel } from "./RightPanel";
import { ShellChromeProvider, useShellChrome } from "./shell-chrome-context";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <ShellChromeProvider>
      <ShellLayout>{children}</ShellLayout>
    </ShellChromeProvider>
  );
}

/**
 * Three-column shell. When the writing surface enters focus mode, the side
 * panels dim and the topbar fades so the user keeps a writing flow.
 * The user can also collapse the right panel manually.
 */
function ShellLayout({ children }: AppShellProps) {
  const { focusMode, rightPanelVisible } = useShellChrome();

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: "var(--surface-0)" }}
    >
      <div
        className={`transition-opacity duration-300 ${
          focusMode ? "opacity-30 hover:opacity-100" : "opacity-100"
        }`}
      >
        <Sidebar />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          className={`transition-opacity duration-300 ${
            focusMode ? "opacity-0 hover:opacity-100" : "opacity-100"
          }`}
        >
          <TopBar />
        </div>
        <main
          className="flex-1 overflow-y-auto"
          style={{ backgroundColor: "var(--surface-0)" }}
        >
          {children}
        </main>
      </div>

      <div
        className={`transition-all duration-300 ease-out ${
          focusMode || !rightPanelVisible
            ? "pointer-events-none opacity-0"
            : "opacity-100"
        }`}
        style={{
          width: focusMode || !rightPanelVisible ? 0 : "var(--panel-width)",
          overflow: "hidden",
        }}
      >
        <RightPanel />
      </div>
    </div>
  );
}
