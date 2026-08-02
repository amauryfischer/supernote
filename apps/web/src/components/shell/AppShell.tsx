"use client";

import { memo } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileShell } from "./mobile/MobileShell";
import { RightPanel } from "./RightPanel";
import { ShellChromeProvider, useHasShellChrome, useShellChrome } from "./shell-chrome-context";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ColumnEditorSidebar } from "@/components/bases/ColumnEditorSidebar";
import { EntityPeekPanel } from "@/components/bases/EntityPeekPanel";

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Top-level chrome dispatcher. Wraps every page; under 768 px renders the
 * `MobileShell` (bottom nav + drawer + sheets), above renders the desktop
 * three-column shell. Both share the same `ShellChromeProvider` so pages
 * can publish chrome config (focus mode, accent overrides, mobile title /
 * FAB / actions) without caring about which shell is active.
 *
 * Le provider est monté par `RootLayout`, donc AU-DESSUS des pages. C'est ce
 * qui rend `useMobileTitle` / `useMobileFab` / `useMobileHeaderActions`
 * utilisables depuis le composant de page lui-même — y compris celui qui rend
 * ce `<AppShell>`. Tant que le provider vivait ici, ces pages publiaient dans
 * le vide (18 sur 26) : titre générique, aucune action d'en-tête, FAB de
 * repli. On ne réinstalle un provider local que s'il n'y en a aucun au-dessus
 * (rendu hors RootLayout : tests, storybook…).
 */
export function AppShell({ children }: AppShellProps) {
  const hasProvider = useHasShellChrome();
  if (hasProvider) return <ShellSwitcher>{children}</ShellSwitcher>;
  return (
    <ShellChromeProvider>
      <ShellSwitcher>{children}</ShellSwitcher>
    </ShellChromeProvider>
  );
}

function ShellSwitcher({ children }: AppShellProps) {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileShell>{children}</MobileShell>;
  return <ShellLayout>{children}</ShellLayout>;
}

/**
 * Stable wrappers: these are memoized so that when focusMode or
 * rightPanelVisible changes, only the wrapper divs re-render — not
 * the Sidebar/TopBar/RightPanel internals (which are also memo'd).
 */
const SidebarWrapper = memo(function SidebarWrapper({ focusMode }: { focusMode: boolean }) {
  return (
    <div
      className={`sn-no-print ${focusMode ? "opacity-30 hover:opacity-100" : "opacity-100"}`}
      style={{
        transition: "opacity var(--sn-dur-4) var(--sn-ease-out)",
      }}
    >
      <Sidebar />
    </div>
  );
});

const TopBarWrapper = memo(function TopBarWrapper({ focusMode }: { focusMode: boolean }) {
  return (
    <div
      className={`sn-no-print ${focusMode ? "opacity-0 hover:opacity-100" : "opacity-100"}`}
      style={{
        transition: "opacity var(--sn-dur-4) var(--sn-ease-out)",
      }}
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
  const collapsed = focusMode || !rightPanelVisible;
  return (
    <div
      className={collapsed ? "pointer-events-none opacity-0" : "opacity-100"}
      style={{
        width: collapsed ? 0 : "var(--panel-width)",
        overflow: "hidden",
        // Width-collapse is the documented layout-prop exception; pair it with
        // opacity so the chrome melts away on the signature out-ease.
        transition:
          "width var(--sn-dur-4) var(--sn-ease-out), opacity var(--sn-dur-4) var(--sn-ease-out)",
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
  const { focusMode, rightPanelVisible, accentOverride, columnEditor, entityPeek } = useShellChrome();

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

      {/* Column editor sidebar — prioritaire sur le right panel normal */}
      {columnEditor ? (
        <ColumnEditorSidebar
          base={columnEditor.base}
          view={columnEditor.view}
          focusFieldId={columnEditor.focusFieldId}
          prefillFormula={columnEditor.prefillFormula}
        />
      ) : (
        <RightPanelWrapper focusMode={focusMode} rightPanelVisible={rightPanelVisible} />
      )}

      {/* Fiche d'entité en side-peek — colonne droite additionnelle qui pousse
          le contenu. Le wrapper porte l'anim d'entrée slide-in (même classe
          .sn-* que l'overlay mobile du column editor). */}
      {entityPeek && (
        <div className="sn-col-editor-enter shrink-0">
          <EntityPeekPanel baseId={entityPeek.baseId} entityId={entityPeek.entityId} />
        </div>
      )}
    </div>
  );
}
