"use client";

import { AppShell } from "@/components/shell";
import {
  ROUTINES,
  TEMPLATE_META,
  RoutineCard,
} from "@/components/routines";
import type { RoutineFixture, TemplateKey } from "@/components/routines";
import { trpc } from "@/lib/trpc/client";
import { Plus, Lightning, CaretDown } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, useRef, useEffect, useCallback } from "react";
import type { Routine } from "@supernote/ipc";
import { EmptyState } from "@supernote/ui";
import { useTranslations } from "next-intl";

// ── IPC → fixture adapter ─────────────────────────────────────────────────

function routineFromIpc(r: Routine): RoutineFixture {
  const trigType = r.trigger.type;
  const fixtureType =
    trigType === "entity.created" || trigType === "entity.updated" || trigType === "entity.deleted"
      ? ("event" as const)
      : trigType === "alarm"
      ? ("alarm" as const)
      : trigType === "webhook"
      ? ("webhook" as const)
      : ("cron" as const);

  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    enabled: r.enabled,
    templateKey: (r.templateKey as TemplateKey | undefined) ?? undefined,
    trigger: {
      type: fixtureType,
      expression: r.trigger.cron,
      entityTypeId: r.trigger.entityTypeId,
      dateField: r.trigger.alarmField,
      offset: r.trigger.alarmOffsetDays !== undefined ? `${r.trigger.alarmOffsetDays}d` : undefined,
    },
    condition: r.conditions,
    actions: r.actions.map((a) => ({
      type: a.type as RoutineFixture["actions"][0]["type"],
      ...a.config,
    })),
    runs: [],
  };
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function RoutineSkeleton() {
  return (
    <div
      className="animate-pulse rounded-xl border p-4"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg" style={{ backgroundColor: "var(--surface-3)" }} />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-40 rounded" style={{ backgroundColor: "var(--surface-3)" }} />
          <div className="h-2.5 w-64 rounded" style={{ backgroundColor: "var(--surface-3)" }} />
        </div>
      </div>
    </div>
  );
}

// ── New routine dropdown ──────────────────────────────────────────────────

const TEMPLATE_KEYS: TemplateKey[] = [
  "weekly-email",
  "birthday-reminder",
  "follow-up",
  "daily-brief",
  "blank",
];

function NewRoutineDropdown() {
  const t = useTranslations("routines");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
        {t("newRoutine")}
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

// ── Page ──────────────────────────────────────────────────────────────────

export default function RoutinesPage() {
  const t = useTranslations("routines");
  const listQuery = trpc.routines.list.useQuery({});
  const updateMutation = trpc.routines.update.useMutation({
    onSuccess: () => { void listQuery.refetch(); },
  });
  const deleteMutation = trpc.routines.delete.useMutation({
    onSuccess: () => { void listQuery.refetch(); },
  });
  const runMutation = trpc.automations.run.useMutation();

  const [localRoutines, setLocalRoutines] = useState<RoutineFixture[] | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const useFallback = listQuery.isError;

  // Effective list: IPC data or fallback fixtures
  const ipcRoutines = (listQuery.data ?? []).map(routineFromIpc);
  const routines: RoutineFixture[] = useFallback
    ? (localRoutines ?? ROUTINES)
    : ipcRoutines;

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  const handleToggleEnabled = useCallback((id: string, enabled: boolean) => {
    if (useFallback) {
      setLocalRoutines((prev) =>
        (prev ?? ROUTINES).map((r) => (r.id === id ? { ...r, enabled } : r))
      );
      return;
    }
    updateMutation.mutate({ id, enabled });
  }, [useFallback, updateMutation]);

  const handleDelete = useCallback((id: string) => {
    if (!confirm(t("deleteConfirm"))) return;
    if (useFallback) {
      setLocalRoutines((prev) => (prev ?? ROUTINES).filter((r) => r.id !== id));
      return;
    }
    deleteMutation.mutate({ id });
  }, [useFallback, deleteMutation]);

  const handleRun = useCallback((id: string) => {
    const name = routines.find((r) => r.id === id)?.name ?? id;
    if (useFallback) {
      showToast(`Routine "${name}" lancée (mode dégradé)`);
      return;
    }
    runMutation.mutate(
      { id },
      {
        onSuccess: (run) => showToast(`"${name}" lancée — ${run.status}`),
        onError: (err) => showToast(`Erreur : ${err.message}`, false),
      },
    );
  }, [routines, useFallback, runMutation]);

  const activeCount = routines.filter((r) => r.enabled).length;

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-3"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
        >
          <div className="flex items-center gap-3">
            <Lightning size={18} style={{ color: "var(--accent)" }} />
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("title")}
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
            {useFallback && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: "oklch(0.93 0.10 60 / 0.20)", color: "oklch(0.50 0.15 60)" }}
              >
                mode dégradé
              </span>
            )}
          </div>
          <NewRoutineDropdown />
        </div>

        {/* Toast */}
        {toast && (
          <div
            className="mx-6 mt-3 rounded-md px-4 py-2 text-sm font-medium"
            style={{
              backgroundColor: toast.ok ? "oklch(0.93 0.05 150 / 0.20)" : "oklch(0.93 0.10 28 / 0.15)",
              color: toast.ok ? "oklch(0.45 0.16 150)" : "var(--danger)",
            }}
          >
            {toast.msg}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {listQuery.isLoading ? (
            <div className="mx-auto max-w-3xl space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <RoutineSkeleton key={i} />)}
            </div>
          ) : routines.length === 0 ? (
            <EmptyState
              icon={<Lightning size={28} />}
              title={t("noRoutines")}
              description={t("noRoutinesHint")}
              action={{ label: t("newRoutineAction"), onClick: () => { window.location.href = "/routines/nouveau"; } }}
              secondaryAction={{ label: t("viewTemplates"), onClick: () => { window.location.href = "/routines/nouveau?template=blank"; } }}
              className="py-24"
            />
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
