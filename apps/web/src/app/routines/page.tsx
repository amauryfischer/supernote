"use client";

import { AppShell, useMobileFab, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@heroui/react";
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
import type { Entity, FieldValue } from "@supernote/ipc";
import { EmptyState } from "@supernote/ui";
import { useTranslations } from "next-intl";
import { entityToRoutine, routineFixtureToEntityFields, ROUTINE_TYPE_ID } from "@/lib/routines/entity-adapter";

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
      <Button
        onPress={() => setOpen((o) => !o)}
        size="sm"
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
        style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
      >
        <Plus size={13} />
        {t("newRoutine")}
        <CaretDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>

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
  const isMobile = useIsMobile();
  const utils = trpc.useUtils();
  const listQuery = trpc.entities.list.useQuery({ typeId: ROUTINE_TYPE_ID });
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: () => { void utils.entities.list.invalidate({ typeId: ROUTINE_TYPE_ID }); },
  });
  const deleteMutation = trpc.entities.delete.useMutation({
    onSuccess: () => { void utils.entities.list.invalidate({ typeId: ROUTINE_TYPE_ID }); },
  });

  const [localRoutines, setLocalRoutines] = useState<RoutineFixture[] | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const useFallback = listQuery.isError;

  // Effective list: IPC data or fallback fixtures
  const ipcRoutines: RoutineFixture[] = ((listQuery.data?.items ?? []) as Entity[]).map(entityToRoutine);
  const routines: RoutineFixture[] = useFallback
    ? (localRoutines ?? ROUTINES) // ROUTINES is [] by default
    : ipcRoutines;

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  const handleToggleEnabled = useCallback((id: string, enabled: boolean) => {
    if (useFallback) {
      setLocalRoutines((prev) =>
        (prev ?? ROUTINES).map((r) => (r.id === id ? { ...r, enabled } : r)) // ROUTINES is [] by default
      );
      return;
    }
    const current = ipcRoutines.find((r) => r.id === id);
    if (!current) return;
    const fields: Record<string, FieldValue> = routineFixtureToEntityFields({ ...current, enabled });
    updateMutation.mutate({ id, fields });
  }, [useFallback, updateMutation, ipcRoutines]);

  const handleDelete = useCallback((id: string) => {
    if (!confirm(t("deleteConfirm"))) return;
    if (useFallback) {
      setLocalRoutines((prev) => (prev ?? ROUTINES).filter((r) => r.id !== id)); // ROUTINES is [] by default
      return;
    }
    deleteMutation.mutate({ id });
  }, [useFallback, deleteMutation, t]);

  const handleRun = useCallback((id: string) => {
    const name = routines.find((r) => r.id === id)?.name ?? id;
    // Manual run is not yet implemented in the worker — show a friendly toast.
    showToast(`Routine "${name}" lancée (mode dégradé)`);
  }, [routines]);

  const activeCount = routines.filter((r) => r.enabled).length;

  // Mobile chrome — publish title, FAB navigates to /routines/nouveau
  useMobileTitle(
    isMobile ? t("title") : null,
    isMobile ? `${activeCount} active${activeCount !== 1 ? "s" : ""}` : null,
  );
  useMobileFab(
    isMobile
      ? { icon: Plus, label: t("newRoutine"), onPress: () => { window.location.href = "/routines/nouveau"; } }
      : null,
  );

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header — hidden on mobile (title and FAB live in the top bar / FAB) */}
        <div
          className="hidden items-center justify-between border-b px-6 py-3 md:flex"
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
        <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-6">
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
