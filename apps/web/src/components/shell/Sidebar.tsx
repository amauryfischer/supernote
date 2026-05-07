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

interface NavItem {
  label: string;
  icon: PhosphorIcon;
  href: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Navigation",
    items: [
      { label: "Accueil", icon: House, href: "/" },
      { label: "Recherche", icon: MagnifyingGlass, href: "/recherche" },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { label: "Notes", icon: FileText, href: "/notes" },
      { label: "Journal", icon: Calendar, href: "/journal" },
      { label: "Contacts", icon: Users, href: "/contacts" },
      { label: "Projets", icon: Stack, href: "/projets" },
      { label: "Finance", icon: Wallet, href: "/finance" },
      { label: "Schémas", icon: Hash, href: "/schemas" },
      { label: "Templates", icon: BookmarkSimple, href: "/templates" },
      { label: "Vues", icon: BookOpen, href: "/vues" },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Canvas", icon: SquaresFour, href: "/canvas" },
      { label: "Graph", icon: Graph, href: "/graph" },
      { label: "Routines", icon: Lightning, href: "/routines" },
    ],
  },
];

const NavLink = memo(function NavLink({ item, active }: { item: NavItem; active: boolean }) {
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
      {item.label}
    </Link>
  );
});

export const Sidebar = memo(function Sidebar() {
  const pathname = usePathname();
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
          <div key={group.label}>
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
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item.href)} />
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
          Paramètres
        </Link>
      </div>
      </aside>
    </>
  );
});
