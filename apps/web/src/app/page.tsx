"use client";

import { AppShell } from "@/components/shell";
import { Card } from "@heroui/react";
import {
  ArrowRight,
  BookOpen,
  Calendar,
  FileText,
  Hash,
  Layers,
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
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Votre système de connaissance et CRM personnel · local-first
          </p>
        </div>

        {/* Empty vault onboarding */}
        <Card
          className="mb-8 border p-6"
          style={{
            backgroundColor: "var(--surface-1)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <Card.Content>
            <div className="flex items-start gap-4">
              <div
                className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: "var(--accent-subtle)" }}
              >
                <FileText size={18} className="text-[var(--accent)]" />
              </div>
              <div>
                <h2
                  className="text-sm font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  Vault vide
                </h2>
                <p
                  className="mt-1 text-xs leading-relaxed"
                  style={{ color: "var(--text-muted)" }}
                >
                  Ouvrez un dossier existant ou créez un nouveau vault pour
                  commencer. Toutes vos données resteront sur votre disque,
                  au format Markdown.
                </p>
                <button
                  className="mt-3 flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ color: "var(--accent)" }}
                >
                  Ouvrir un vault
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          </Card.Content>
        </Card>

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
