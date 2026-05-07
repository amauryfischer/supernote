"use client";

import {
  Bell,
  BookmarkSimple,
  BookOpen,
  Calendar,
  FileText,
  Gear,
  Graph,
  Hash,
  House,
  Lightning,
  MagnifyingGlass,
  SquaresFour,
  Stack,
  Users,
  Wallet,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { memo, useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { NotificationBadge, NotificationCenter, useNotifications } from "@supernote/notifications/renderer";
import { useTranslations } from "next-intl";

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
      { labelKey: "nav.journal", icon: Calendar, href: "/journal" },
      { labelKey: "nav.contacts", icon: Users, href: "/contacts" },
      { labelKey: "nav.projects", icon: Stack, href: "/projets" },
      { labelKey: "nav.finance", icon: Wallet, href: "/finance" },
      { labelKey: "nav.schemas", icon: Hash, href: "/schemas" },
      { labelKey: "nav.templates", icon: BookmarkSimple, href: "/templates" },
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
      <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
      <aside
        className="shell-chrome flex h-full flex-col border-r"
        style={{
          width: "var(--sidebar-width)",
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--surface-1)",
        }}
      >
        {/* App brand */}
        <div
          className="flex items-center justify-between px-4"
          style={{ height: "var(--header-height)" }}
        >
          <Link
            href="/"
            prefetch={true}
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80 focus-visible:outline-none"
          >
            <div
              className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold"
              style={{
                backgroundColor: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              S
            </div>
            <span
              className="text-sm font-semibold tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              Supernote
            </span>
          </Link>
          <button
            onClick={() => setNotifOpen(true)}
            aria-label="Ouvrir le centre de notifications"
            className="relative flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
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

      {/* Navigation groups */}
      <nav data-tour="sidebar-nav" className="flex flex-1 flex-col overflow-y-auto p-2">
        {NAV_GROUPS.map((group, groupIndex) => (
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
              {group.items.map((item) => (
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
