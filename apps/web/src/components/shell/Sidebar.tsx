"use client";

import {
  Bell,
  BookOpen,
  Calendar,
  CheckSquare,
  FileText,
  FolderOpen,
  Gear,
  Graph,
  House,
  Lightning,
  MagnifyingGlass,
  SquaresFour,
  Stack,
  Tag,
  Users,
  Wallet,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { NotificationBadge, useNotifications } from "@supernote/notifications/renderer";
import { useTranslations } from "next-intl";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import {
  BUILT_IN_PLUGINS,
  PLUGIN_HREF_BY_SLUG,
  usePluginEnabled,
} from "@/hooks/usePluginEnabled";

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
      { labelKey: "nav.search", icon: MagnifyingGlass, href: "/recherche" },
    ],
  },
  {
    labelKey: "nav.groups.knowledge",
    items: [
      { labelKey: "nav.notes", icon: FileText, href: "/notes" },
      { labelKey: "nav.todos", icon: CheckSquare, href: "/todos" },
      { labelKey: "nav.journal", icon: Calendar, href: "/journal" },
      { labelKey: "nav.contacts", icon: Users, href: "/contacts" },
      { labelKey: "nav.projects", icon: Stack, href: "/projets" },
      { labelKey: "nav.finance", icon: Wallet, href: "/finance" },
      { labelKey: "nav.tags", icon: Tag, href: "/tags" },
      { labelKey: "nav.views", icon: BookOpen, href: "/vues" },
    ],
  },
  {
    labelKey: "nav.groups.tools",
    items: [
      { labelKey: "nav.canvas", icon: SquaresFour, href: "/canvas" },
      { labelKey: "nav.graph", icon: Graph, href: "/graph" },
      { labelKey: "nav.routines", icon: Lightning, href: "/routines" },
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
  const canvasEnabled = usePluginEnabled("canvas", true);
  const graphEnabled = usePluginEnabled("graph", true);
  const pluginEnabledByHref: Record<string, boolean> = {
    [PLUGIN_HREF_BY_SLUG.journal]: journalEnabled,
    [PLUGIN_HREF_BY_SLUG.routines]: routinesEnabled,
    [PLUGIN_HREF_BY_SLUG.canvas]: canvasEnabled,
    [PLUGIN_HREF_BY_SLUG.graph]: graphEnabled,
  };
  // Reference BUILT_IN_PLUGINS so future additions surface a type error
  // here when the catalogue and hook calls drift apart.
  void BUILT_IN_PLUGINS;
  // Show the active vault name in the brand header. In Electron the PWA hook
  // is bypassed (vault === null) and we fall back to the static product name.
  // In PWA mode an empty `vaultName` means we haven't received VAULT_READY
  // yet (still loading or running in degraded localStorage mode).
  const brandLabel =
    vault && vault.isPwa
      ? vault.vaultName ?? (vault.state === "degraded" ? "Aucun vault" : "Supernote")
      : "Supernote";
  const canPickVault = Boolean(vault?.isPwa);

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
        {/* App brand — also surfaces the active vault in PWA mode so the
            user can see which folder is open and re-pick it without hunting
            through settings. */}
        <div
          className="flex items-center justify-between gap-1 px-4"
          style={{ height: "var(--header-height)" }}
        >
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
              S
            </div>
            <span
              className="truncate text-sm font-semibold tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {brandLabel}
            </span>
          </Link>
          {canPickVault && (
            <button
              onClick={() => void vault?.pickFolder()}
              aria-label="Changer de vault"
              title="Changer de vault"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <FolderOpen size={14} />
            </button>
          )}
          <button
            onClick={() => setNotifOpen(true)}
            aria-label="Ouvrir le centre de notifications"
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            <Bell size={15} />
            <NotificationBadge
              count={unreadCount}
              className="absolute -right-1 -top-1"
            />
          </button>
        </div>

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
