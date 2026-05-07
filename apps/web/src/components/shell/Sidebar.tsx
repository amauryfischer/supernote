"use client";

import { Button } from "@heroui/react";
import {
  BookOpen,
  Calendar,
  FileText,
  Hash,
  Home,
  Layers,
  Search,
  Settings,
  Users,
  Zap,
} from "lucide-react";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string;
  active?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Accueil", icon: Home, href: "/", active: true },
  { label: "Recherche", icon: Search, href: "/search" },
  { label: "Notes", icon: FileText, href: "/notes" },
  { label: "Journal", icon: Calendar, href: "/daily" },
  { label: "Contacts", icon: Users, href: "/contacts" },
  { label: "Projets", icon: Layers, href: "/projects" },
  { label: "Schémas", icon: Hash, href: "/schemas" },
  { label: "Vues", icon: BookOpen, href: "/views" },
  { label: "Routines", icon: Zap, href: "/routines" },
];

export function Sidebar() {
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
      <div
        className="flex items-center gap-2.5 px-4"
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
      </div>

      <div
        className="border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      />

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => (
          <Button
            key={item.href}
            variant={item.active ? "secondary" : "ghost"}
            className="w-full justify-start gap-2.5 px-3 py-2 text-sm font-normal"
            style={
              item.active
                ? {
                    backgroundColor: "var(--accent-subtle)",
                    color: "var(--accent)",
                  }
                : { color: "var(--text-secondary)" }
            }
          >
            <item.icon size={15} />
            {item.label}
          </Button>
        ))}
      </nav>

      {/* Bottom settings */}
      <div
        className="border-t p-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 px-3 py-2 text-sm font-normal"
          style={{ color: "var(--text-muted)" }}
        >
          <Settings size={15} />
          Paramètres
        </Button>
      </div>
    </aside>
  );
}
