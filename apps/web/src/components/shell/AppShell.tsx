"use client";

import { RightPanel } from "./RightPanel";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Three-column application shell:
 *   [Sidebar (240px)] | [TopBar + Content (flex-1)] | [RightPanel (280px)]
 *
 * The outer container fills the viewport height. In Electron dev, Next.js
 * serves on localhost:3000 so the full-viewport approach works natively.
 * In prod static export, the same layout applies since Electron sizes the
 * BrowserWindow to fill the screen.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: "var(--surface-0)" }}
    >
      {/* Left sidebar */}
      <Sidebar />

      {/* Main area: topbar + scrollable content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main
          className="flex-1 overflow-y-auto"
          style={{ backgroundColor: "var(--surface-0)" }}
        >
          {children}
        </main>
      </div>

      {/* Right context panel */}
      <RightPanel />
    </div>
  );
}
