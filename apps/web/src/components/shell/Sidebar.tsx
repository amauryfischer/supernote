"use client";

import {
  Archive,
  Bell,
  CaretDown,
  Calendar,
  CheckSquare,
  Cloud,
  FileText,
  Function,
  Gear,
  GridNine,
  House,
  Plant,
  Lightning,
  Robot,
  Tag,
  Timer,
  Users,
  Wallet,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NotificationBadge, useNotifications } from "@supernote/notifications/renderer";
import { useTranslations } from "next-intl";
import { useVault, type RecentVault } from "@/lib/pwa/PwaVaultSetup";
import { VaultSwitcherList } from "./VaultSwitcherList";
import {
  BUILT_IN_PLUGINS,
  PLUGIN_HREF_BY_SLUG,
  usePluginEnabled,
} from "@/hooks/usePluginEnabled";
import { Button } from "@supernote/ui";

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

interface NavItem {
  labelKey: string;
  icon: PhosphorIcon;
  href: string;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "nav.groups.navigation",
    items: [
      { labelKey: "nav.home", icon: House, href: "/" },
      { labelKey: "nav.ai", icon: Robot, href: "/ai" },
    ],
  },
  {
    labelKey: "nav.groups.knowledge",
    items: [
      { labelKey: "nav.notes", icon: FileText, href: "/notes" },
      { labelKey: "nav.archive", icon: Archive, href: "/archive" },
      { labelKey: "nav.garden", icon: Plant, href: "/garden" },
      { labelKey: "nav.todos", icon: CheckSquare, href: "/todos" },
      { labelKey: "nav.habits", icon: GridNine, href: "/habits" },
      { labelKey: "nav.journal", icon: Calendar, href: "/journal" },
      { labelKey: "nav.contacts", icon: Users, href: "/contacts" },
      { labelKey: "nav.finance", icon: Wallet, href: "/finance" },
    ],
  },
  {
    labelKey: "nav.groups.tools",
    items: [
      { labelKey: "nav.tags", icon: Tag, href: "/tags" },
      { labelKey: "nav.variables", icon: Function, href: "/variables" },
      { labelKey: "nav.routines", icon: Lightning, href: "/routines" },
      { labelKey: "nav.pomodoro", icon: Timer, href: "/pomodoro" },
    ],
  },
];

const NavLink = memo(function NavLink({
  item,
  active,
  label,
}: {
  item: NavItem;
  active: boolean;
  label: string;
}) {
  // Hover state is applied via direct style mutation on inactive items —
  // a Tailwind `hover:bg-…` would lose to the inline `color` set below
  // (inline always beats pseudo-classes), and the active style needs to
  // remain stable on hover. Same approach as FolderNode in the FileTree.
  return (
    <Link
      href={item.href}
      prefetch={true}
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-normal transition-colors focus-visible:outline-none"
      style={
        active
          ? {
              backgroundColor: "var(--accent-subtle)",
              color: "var(--accent)",
              fontWeight: 500,
            }
          : { color: "var(--text-secondary)" }
      }
      onMouseEnter={(e) => {
        if (active) return;
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.backgroundColor = "var(--surface-2)";
        el.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        if (active) return;
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.backgroundColor = "";
        el.style.color = "var(--text-secondary)";
      }}
    >
      <item.icon size={15} />
      {label}
    </Link>
  );
});

export const Sidebar = memo(function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const [notifOpen, setNotifOpen] = useState(false);
  const { unreadCount } = useNotifications();
  const vault = useVault();

  // Built-in features behave like plugins: each has a localStorage flag
  // controlling whether its sidebar entry is visible. We must call hooks
  // in a fixed order, so we read every known plugin upfront and build a
  // href → enabled map that the render pass consults below.
  const journalEnabled = usePluginEnabled("journal", false);
  const routinesEnabled = usePluginEnabled("routines", true);
  const pluginEnabledByHref: Record<string, boolean> = {
    [PLUGIN_HREF_BY_SLUG.journal]: journalEnabled,
    [PLUGIN_HREF_BY_SLUG.routines]: routinesEnabled,
  };
  // Reference BUILT_IN_PLUGINS so future additions surface a type error
  // here when the catalogue and hook calls drift apart.
  void BUILT_IN_PLUGINS;
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

  // Keyboard shortcut: Cmd+Alt+N
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === "n") {
        e.preventDefault();
        setNotifOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      {notifOpen && (
        <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
      )}
      <aside
        className="shell-chrome flex h-full flex-col border-r"
        style={{
          width: "var(--sidebar-width)",
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--surface-1)",
        }}
      >
        {/* App brand — in PWA mode this opens the vault switcher popover so
            the user can swap between known vaults (or pick a new one) from
            the top-left without hunting through settings. In Electron the
            label is non-interactive and renders as a plain Link to home. */}
        <div
          className="flex items-center justify-between gap-1 px-4"
          style={{ height: "var(--header-height)" }}
        >
          {canPickVault ? (
            <Button
              ref={brandRef}
              type="button"
              variant="ghost"
              onClick={() => setSwitcherOpen((v) => !v)}
              aria-label="Changer de vault"
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 -mx-1"
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "var(--accent-foreground)",
                }}
              >
                {isCloudVault ? <Cloud size={14} weight="fill" /> : "S"}
              </div>
              <span
                className="truncate text-sm font-semibold tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {brandLabel}
              </span>
              <CaretDown size={11} weight="bold" style={{ color: "var(--text-muted)" }} />
            </Button>
          ) : (
            <Link
              href="/"
              prefetch={true}
              title={brandLabel}
              className="flex min-w-0 flex-1 items-center gap-2.5 transition-opacity hover:opacity-80 focus-visible:outline-none"
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "var(--accent-foreground)",
                }}
              >
                {isCloudVault ? <Cloud size={14} weight="fill" /> : "S"}
              </div>
              <span
                className="truncate text-sm font-semibold tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {brandLabel}
              </span>
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNotifOpen(true)}
            aria-label="Ouvrir le centre de notifications"
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
            style={{ color: "var(--text-muted)" }}
          >
            <Bell size={15} />
            <NotificationBadge
              count={unreadCount}
              className="absolute -right-1 -top-1"
            />
          </Button>
        </div>
        {canPickVault && vault && (
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
        )}

      <div
        className="border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      />

      {/* Navigation groups. Items belonging to a disabled plugin are
          filtered out — the underlying route still works for direct
          navigation, only the sidebar entry is hidden. Empty groups are
          collapsed entirely so we don't render dangling section headers. */}
      <nav data-tour="sidebar-nav" className="flex flex-1 flex-col overflow-y-auto p-2">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => {
            const pluginEnabled = pluginEnabledByHref[item.href];
            return pluginEnabled === undefined ? true : pluginEnabled;
          });
          return { group, visibleItems };
        })
          .filter(({ visibleItems }) => visibleItems.length > 0)
          .map(({ group, visibleItems }, groupIndex) => (
            <div key={group.labelKey}>
              {groupIndex > 0 && (
                <div
                  className="mx-3 my-1.5 border-t"
                  style={{ borderColor: "var(--border-subtle)" }}
                />
              )}
              <p
                className="mb-0.5 mt-1 px-3 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}
              >
                {t(group.labelKey)}
              </p>
              <div className="flex flex-col gap-0.5">
                {visibleItems.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isActive(item.href)}
                    label={t(item.labelKey)}
                  />
                ))}
              </div>
            </div>
          ))}
      </nav>

      {/* Bottom settings */}
      <div
        className="border-t p-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Link
          href="/parametres"
          prefetch={true}
          data-tour="settings-link"
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-normal transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none"
          style={{
            color: isActive("/parametres") ? "var(--accent)" : "var(--text-muted)",
            backgroundColor: isActive("/parametres") ? "var(--accent-subtle)" : undefined,
          }}
        >
          <Gear size={15} />
          {t("nav.settings")}
        </Link>
      </div>
      </aside>
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
      className="fixed z-50 flex flex-col rounded-lg p-1 shadow-xl"
      style={{
        left,
        top,
        width: POP_W,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
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
