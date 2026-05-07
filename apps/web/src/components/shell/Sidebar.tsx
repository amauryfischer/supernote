"use client";

import {
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
import { usePathname } from "next/navigation";

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

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-normal transition-colors"
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
}

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside
      className="shell-chrome flex h-full flex-col border-r"
      style={{
        width: "var(--sidebar-width)",
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      {/* App brand */}
      <Link
        href="/"
        className="flex items-center gap-2.5 px-4 transition-opacity hover:opacity-80"
        style={{ height: "var(--header-height)" }}
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
          data-tour="settings-link"
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-normal transition-colors hover:bg-[var(--surface-2)]"
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
  );
}
