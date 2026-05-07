"use client";

import {
  BookOpen,
  Calendar,
  FileText,
  Hash,
  House,
  MagnifyingGlass,
  Gear,
  Stack,
  Users,
  Wallet,
  Lightning,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  label: string;
  icon: PhosphorIcon;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Accueil", icon: House, href: "/" },
  { label: "Recherche", icon: MagnifyingGlass, href: "/recherche" },
  { label: "Notes", icon: FileText, href: "/notes" },
  { label: "Journal", icon: Calendar, href: "/journal" },
  { label: "Contacts", icon: Users, href: "/contacts" },
  { label: "Projets", icon: Stack, href: "/projets" },
  { label: "Finance", icon: Wallet, href: "/finance" },
  { label: "Schémas", icon: Hash, href: "/schemas" },
  { label: "Vues", icon: BookOpen, href: "/vues" },
  { label: "Routines", icon: Lightning, href: "/routines" },
];

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

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
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
        })}
      </nav>

      {/* Bottom settings */}
      <div
        className="border-t p-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Link
          href="/parametres"
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
