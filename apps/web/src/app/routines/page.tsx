"use client";

import { AppShell } from "@/components/shell";
import {
  ROUTINES,
  TEMPLATE_META,
  RoutineCard,
  getTemplateRoutine,
  getBlankRoutine,
} from "@/components/routines";
import type { RoutineFixture, TemplateKey } from "@/components/routines";
import { Plus, Lightning, CaretDown } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";

const TEMPLATE_KEYS: TemplateKey[] = [
  "weekly-email",
  "birthday-reminder",
  "follow-up",
  "daily-brief",
  "blank",
];

function NewRoutineDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
        style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
      >
        <Plus size={13} />
        Nouvelle routine
        <CaretDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 z-30 mt-1.5 w-56 rounded-lg border py-1 shadow-lg"
          style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
        >
          {TEMPLATE_KEYS.map((key) => (
            <Link
              key={key}
              href={`/routines/nouveau?template=${key}`}
              onClick={() => setOpen(false)}
              className="flex flex-col px-3 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                {TEMPLATE_META[key].label}
              </span>
              <span className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                {TEMPLATE_META[key].description}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<RoutineFixture[]>(ROUTINES);

  function handleToggleEnabled(id: string, enabled: boolean) {
    setRoutines((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled } : r))
    );
  }

  function handleDelete(id: string) {
    if (!confirm("Supprimer cette routine ?")) return;
    setRoutines((prev) => prev.filter((r) => r.id !== id));
  }

  function handleRun(id: string) {
    alert(`Lancement de la routine "${routines.find((r) => r.id === id)?.name}"…\n\n(mock — pas de backend)`);
  }

  const activeCount = routines.filter((r) => r.enabled).length;

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Page header */}
        <div
          className="flex items-center justify-between border-b px-6 py-3"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
        >
          <div className="flex items-center gap-3">
            <Lightning size={18} style={{ color: "var(--accent)" }} />
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Routines
            </h1>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
            >
              {routines.length}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "oklch(0.93 0.05 150 / 0.20)", color: "oklch(0.45 0.16 150)" }}
            >
              {activeCount} active{activeCount !== 1 ? "s" : ""}
            </span>
          </div>
          <NewRoutineDropdown />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {routines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Lightning size={40} style={{ color: "var(--text-muted)", marginBottom: 12 }} />
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                Aucune routine
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                Créez votre première routine en cliquant sur &quot;+ Nouvelle routine&quot;
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-3">
              {routines.map((routine) => (
                <RoutineCard
                  key={routine.id}
                  routine={routine}
                  onToggleEnabled={handleToggleEnabled}
                  onDelete={handleDelete}
                  onRun={handleRun}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
