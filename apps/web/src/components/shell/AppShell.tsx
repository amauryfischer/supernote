"use client";

import { memo } from "react";
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
 * Stable wrappers: these are memoized so that when focusMode or
 * rightPanelVisible changes, only the wrapper divs re-render — not
 * the Sidebar/TopBar/RightPanel internals (which are also memo'd).
 */
const SidebarWrapper = memo(function SidebarWrapper({ focusMode }: { focusMode: boolean }) {
  return (
    <div
      className={`transition-opacity duration-300 ${
        focusMode ? "opacity-30 hover:opacity-100" : "opacity-100"
      }`}
    >
      <Sidebar />
    </div>
  );
});

const TopBarWrapper = memo(function TopBarWrapper({ focusMode }: { focusMode: boolean }) {
  return (
    <div
      className={`transition-opacity duration-300 ${
        focusMode ? "opacity-0 hover:opacity-100" : "opacity-100"
      }`}
    >
      <TopBar />
    </div>
  );
});

const RightPanelWrapper = memo(function RightPanelWrapper({
  focusMode,
  rightPanelVisible,
}: {
  focusMode: boolean;
  rightPanelVisible: boolean;
}) {
  return (
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
  );
});

/**
 * Three-column shell. When the writing surface enters focus mode, the side
 * panels dim and the topbar fades so the user keeps a writing flow.
 * The user can also collapse the right panel manually.
 */
function ShellLayout({ children }: AppShellProps) {
  const { focusMode, rightPanelVisible, accentOverride } = useShellChrome();

  // Folder-scoped accent override propagates through CSS-variable inheritance.
  // Setting `--accent` / `--accent-subtle` / … on the outermost shell element
  // means the sidebar, topbar, right panel AND content all pick it up — not
  // just the editor pane like before. Cleared back to defaults when the
  // current route doesn't publish an override (e.g. /tags, /todos).
  const rootStyle: React.CSSProperties = {
    backgroundColor: "var(--surface-0)",
    ...(accentOverride ?? {}),
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={rootStyle}>
      <SidebarWrapper focusMode={focusMode} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBarWrapper focusMode={focusMode} />
        <main
          className="flex-1 overflow-y-auto"
          style={{ backgroundColor: "var(--surface-0)" }}
        >
          {children}
        </main>
      </div>

      <RightPanelWrapper focusMode={focusMode} rightPanelVisible={rightPanelVisible} />
    </div>
  );
}
