"use client";

import { AppShell } from "@/components/shell";
import {
  BookOpen,
  Calendar,
  FileText,
  Hash,
  Layers,
  PenLine,
  Users,
  Zap,
} from "lucide-react";

interface QuickAccessItem {
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const QUICK_ACCESS: QuickAccessItem[] = [
  {
    label: "Notes",
    description: "Vos notes libres et documents",
    icon: FileText,
  },
  {
    label: "Contacts",
    description: "Personnes et organisations",
    icon: Users,
  },
  {
    label: "Projets",
    description: "Projets et tâches actives",
    icon: Layers,
  },
  {
    label: "Journal",
    description: "Notes quotidiennes",
    icon: Calendar,
  },
  {
    label: "Schémas",
    description: "Types d'entités et champs",
    icon: Hash,
  },
  {
    label: "Vues",
    description: "Requêtes et vues sauvegardées",
    icon: BookOpen,
  },
  {
    label: "Routines",
    description: "Automations et rappels",
    icon: Zap,
  },
];

export default function HomePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-8 py-12">
        {/* Hero heading */}
        <div className="mb-10">
          <h1
            className="text-3xl font-semibold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Supernote
          </h1>
        </div>

        {/* Primary CTA — create a note directly */}
        <button
          className="mb-8 flex w-full items-center gap-4 rounded-xl border p-5 text-left transition-colors hover:bg-[var(--surface-2)]"
          style={{
            backgroundColor: "var(--surface-1)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            <PenLine size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Nouvelle note
            </h2>
            <p
              className="mt-0.5 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              Commencez à écrire — la note sera classée dans Inbox.
            </p>
          </div>
          <kbd
            className="hidden rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide sm:inline-block"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-muted)",
              backgroundColor: "var(--surface-2)",
            }}
          >
            ⌘ N
          </kbd>
        </button>

        {/* Quick access grid */}
        <div>
          <h2
            className="mb-4 text-xs font-medium uppercase tracking-widest"
            style={{ color: "var(--text-muted)" }}
          >
            Accès rapide
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_ACCESS.map((item) => (
              <button
                key={item.label}
                className="group flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-2)]"
                style={{
                  backgroundColor: "var(--surface-1)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: "var(--surface-2)" }}
                >
                  <item.icon
                    size={15}
                    className="text-[var(--text-secondary)]"
                  />
                </div>
                <div className="min-w-0">
                  <p
                    className="text-sm font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {item.label}
                  </p>
                  <p
                    className="truncate text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {item.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
