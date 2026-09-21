"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useNotifications } from "@supernote/notifications/renderer";
import { useTranslations } from "next-intl";
import { useVault, type RecentVault } from "@/lib/pwa/PwaVaultSetup";
import { VaultSwitcherList } from "./VaultSwitcherList";
import { usePluginEnabled } from "@/hooks/usePluginEnabled";
import { SidebarRail, type RailGroup } from "./SidebarRail";
import { useInboxUnreadCount } from "@/hooks/useInboxUnreadCount";
import {
  NAV_GROUP_ORDER,
  NAV_SETTINGS,
  navItemsInGroup,
  type NavItem,
  type NavGate,
} from "@/lib/navigation/catalog";

// NotificationCenter is heavy and only mounts when the panel is open. Loading
// it lazily keeps the initial sidebar bundle small (Turbopack can tree-shake
// the chunk out of the critical path entirely).
const NotificationCenter = dynamic(
  () =>
    import("@supernote/notifications/renderer").then((m) => ({
      default: m.NotificationCenter,
    })),
  { ssr: false },
);

export const Sidebar = memo(function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const [notifOpen, setNotifOpen] = useState(false);
  const { unreadCount } = useNotifications();
  const vault = useVault();

  // Built-in features behave like plugins: each has a localStorage flag
  // controlling whether its nav entry is visible. Hooks must run in a fixed
  // order, so we read every gate upfront and expose an item→visible predicate.
  // Le catalogue `catalog.ts` tague chaque item avec un `gate` ; on applique
  // ici la MÊME logique que le drawer mobile.
  const routinesEnabled = usePluginEnabled("routines", true);
  // Fils non lus en boîte de réception → badge discret sur l'entrée « Mail ».
  // Le hook renvoie 0 (donc pas de badge) tant que Gmail n'est pas connecté.
  const mailUnread = useInboxUnreadCount();
  const gateEnabled: Record<NavGate, boolean> = {
    routines: routinesEnabled,
  };
  const isItemVisible = useCallback(
    (item: NavItem) => (item.gate ? gateEnabled[item.gate] : true),
    [routinesEnabled],
  );
  // Show the active vault name in the brand header. In Electron the PWA hook
  // is bypassed (vault === null) and we fall back to the static product name.
  // In PWA mode an empty `vaultName` means we haven't received VAULT_READY
  // yet (still loading or running in degraded localStorage mode).
  //
  // A device can host folder vaults (FSA) and/or cloud vaults (OPFS); the brand
  // opens the switcher whenever either is possible. For a cloud vault the worker
  // reports a generic "Coffre cloud" name — we override it with the room key
  // (the active cloud entry's name) and swap the badge for a cloud glyph.
  const activeEntry =
    vault?.recentVaults.find((v) => v.id === vault.activeVaultId) ?? null;
  const isCloudVault = activeEntry?.kind === "cloud";
  const canPickVault = Boolean(vault && (vault.isPwa || vault.canCloud));
  const brandLabel = canPickVault
    ? isCloudVault
      ? activeEntry!.name
      : vault!.vaultName ?? (vault!.state === "degraded" ? "Aucun vault" : "Supernote")
    : "Supernote";
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const brandRef = useRef<HTMLButtonElement>(null);

  const isActive = useCallback(
    (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href)),
    [pathname],
  );

  // Raccourci notifications : Cmd/Ctrl+Alt+B (« bell »). Cmd+Alt+N est réservé
  // à « nouvelle note » (pages /notes, via ShortcutProvider) — les deux se
  // masquaient selon la route.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === "b") {
        e.preventDefault();
        setNotifOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const switcher =
    canPickVault && vault ? (
      <VaultSwitcherPopover
        open={switcherOpen}
        anchorRef={brandRef}
        recents={vault.recentVaults}
        activeId={vault.activeVaultId}
        onSwitch={(id) => {
          setSwitcherOpen(false);
          void vault.switchToVault(id);
        }}
        onForget={(id) => {
          void vault.forgetVault(id);
        }}
        onPickFolder={
          vault.isPwa
            ? () => {
                setSwitcherOpen(false);
                void vault.pickFolder();
              }
            : undefined
        }
        onStartGit={
          vault.isPwa
            ? () => {
                setSwitcherOpen(false);
                vault.startGitFlow();
              }
            : undefined
        }
        onStartCloud={
          vault.canCloud
            ? () => {
                setSwitcherOpen(false);
                vault.startCloudFlow();
              }
            : undefined
        }
        onClose={() => setSwitcherOpen(false)}
      />
    ) : null;

  const groups: RailGroup[] = NAV_GROUP_ORDER.map((groupId) => ({
    groupId,
    items: navItemsInGroup(groupId).filter(isItemVisible),
  })).filter(({ items }) => items.length > 0);

  return (
    <>
      {notifOpen && (
        <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
      )}
      <SidebarRail
        brandLabel={brandLabel}
        canPickVault={canPickVault}
        brandRef={brandRef}
        switcherOpen={switcherOpen}
        onToggleSwitcher={() => setSwitcherOpen((v) => !v)}
        groups={groups}
        isActive={isActive}
        labelOf={(item) => t(item.labelKey)}
        settingsLabel={t(NAV_SETTINGS.labelKey)}
        mailUnread={mailUnread}
        unreadNotifications={unreadCount}
        onOpenNotifications={() => setNotifOpen(true)}
      />
      {switcher}
    </>
  );
});

/* ── Vault switcher ───────────────────────────────────────────────────── */

interface VaultSwitcherPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  recents: ReadonlyArray<RecentVault>;
  activeId: string | null;
  onSwitch: (id: string) => void;
  onForget: (id: string) => void;
  onPickFolder?: () => void;
  onStartGit?: () => void;
  onStartCloud?: () => void;
  onClose: () => void;
}

/**
 * Anchored popover listing known vaults so the user can switch between
 * folders without leaving the sidebar. Same lightweight pattern as
 * `ColorPickerPopover` — no portal, `position: fixed` next to the trigger,
 * click-outside + Escape close.
 */
function VaultSwitcherPopover({
  open,
  anchorRef,
  recents,
  activeId,
  onSwitch,
  onForget,
  onPickFolder,
  onStartGit,
  onStartCloud,
  onClose,
}: VaultSwitcherPopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;
    // Recompute on open so the rect reflects the current sidebar width
    // and chrome state (which may have shifted since last open).
    setRect(anchorRef.current?.getBoundingClientRect() ?? null);
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !rect) return null;

  const POP_W = 256;
  const margin = 4;
  let left = rect.left;
  const top = rect.bottom + margin;
  if (left + POP_W > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - POP_W - 8);
  }

  return (
    <div
      ref={popRef}
      role="menu"
      aria-label="Vaults récents"
      className="fixed z-50 flex flex-col rounded-[var(--radius-lg)] p-1 shadow-lg"
      style={{
        left,
        top,
        width: POP_W,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border)",
      }}
    >
      <VaultSwitcherList
        recents={recents}
        activeId={activeId}
        onSwitch={onSwitch}
        onForget={onForget}
        onPickFolder={onPickFolder}
        onStartGit={onStartGit}
        onStartCloud={onStartCloud}
      />
    </div>
  );
}
