"use client";

import { AppShell } from "@/components/shell";
import { ROUTINES, RoutineEditor } from "@/components/routines";
import type { RoutineFixture, TemplateKey } from "@/components/routines";
import { trpc } from "@/lib/trpc/client";
import { useRouter, useParams } from "next/navigation";
import { useState, useCallback } from "react";
import Link from "next/link";
import type { Routine, UpdateRoutineInput } from "@supernote/ipc";

// ── IPC adapters ──────────────────────────────────────────────────────────

function routineFromIpc(r: Routine): RoutineFixture {
  const t = r.trigger.type;
  const fixtureType =
    t === "entity.created" || t === "entity.updated" || t === "entity.deleted"
      ? ("event" as const)
      : t === "alarm"
      ? ("alarm" as const)
      : t === "webhook"
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

function fixtureToUpdateInput(f: RoutineFixture): UpdateRoutineInput {
  const trigType = f.trigger.type === "event"
    ? ("entity.created" as const)
    : f.trigger.type === "alarm"
    ? ("alarm" as const)
    : f.trigger.type === "webhook"
    ? ("webhook" as const)
    : ("cron" as const);

  return {
    id: f.id,
    name: f.name,
    description: f.description || undefined,
    enabled: f.enabled,
    conditions: f.condition,
    trigger: {
      type: trigType,
      cron: f.trigger.expression,
      entityTypeId: f.trigger.entityTypeId,
      alarmField: f.trigger.dateField,
      alarmOffsetDays: f.trigger.offset
        ? parseInt(f.trigger.offset.replace("d", ""), 10)
        : undefined,
    },
    actions: f.actions.map((a) => {
      const { type, ...config } = a;
      return {
        type: type as import("@supernote/ipc").ActionType,
        config: config as Record<string, unknown>,
      };
    }),
  };
}

// ── Loading skeleton ──────────────────────────────────────────────────────

function RoutineDetailSkeleton() {
  return (
    <div className="flex h-full flex-col animate-pulse">
      <div
        className="flex items-center justify-between border-b px-6 py-3"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="h-4 w-48 rounded" style={{ backgroundColor: "var(--surface-3)" }} />
        <div className="h-7 w-24 rounded-md" style={{ backgroundColor: "var(--surface-3)" }} />
      </div>
      <div className="flex-1 px-8 py-6">
        <div className="mx-auto max-w-xl space-y-4">
          <div className="h-24 rounded-xl" style={{ backgroundColor: "var(--surface-1)" }} />
          <div className="h-32 rounded-xl" style={{ backgroundColor: "var(--surface-1)" }} />
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function RoutineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = params.id;
  const id: string = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? (rawId[0] ?? "") : "";

  const getQuery = trpc.routines.get.useQuery({ id: id || "none" }, { retry: false });
  const nextRunsQuery = trpc.routines.getNextRuns.useQuery(
    { id: id || "none", count: 3 },
    { retry: false, enabled: !!id && !getQuery.isError },
  );
  const updateMutation = trpc.routines.update.useMutation({
    onSuccess: () => { void getQuery.refetch(); },
  });
  const runMutation = trpc.automations.run.useMutation();

  const [toast, setToast] = useState<string | null>(null);

  const useFallback = getQuery.isError;
  const fallbackRoutine = ROUTINES.find((r) => r.id === id) ?? null;

  const routine: RoutineFixture | null = useFallback
    ? fallbackRoutine
    : getQuery.data
    ? routineFromIpc(getQuery.data)
    : null;

  const nextRuns: string[] = nextRunsQuery.data ?? [];

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  const handleSave = useCallback(
    (updated: RoutineFixture) => {
      if (useFallback) {
        showToast("Enregistré (mode dégradé)");
        return;
      }
      updateMutation.mutate(fixtureToUpdateInput(updated), {
        onSuccess: () => showToast("Routine enregistrée"),
        onError: (err) => showToast(`Erreur : ${err.message}`),
      });
    },
    [useFallback, updateMutation],
  );

  const handleRunNow = useCallback(() => {
    if (useFallback) {
      showToast("Routine lancée (mode dégradé)");
      return;
    }
    runMutation.mutate(
      { id },
      {
        onSuccess: (run) => showToast(`Lancée — statut : ${run.status}`),
        onError: (err) => showToast(`Erreur : ${err.message}`),
      },
    );
  }, [id, useFallback, runMutation]);

  if (getQuery.isLoading) {
    return (
      <AppShell>
        <RoutineDetailSkeleton />
      </AppShell>
    );
  }

  if (!routine) {
    return (
      <AppShell>
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Routine introuvable :{" "}
            <code className="rounded px-1" style={{ backgroundColor: "var(--surface-2)" }}>{id}</code>
          </p>
          <Link
            href="/routines"
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            Retour aux routines
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {nextRuns.length > 0 && (
          <div
            className="flex items-center gap-2 border-b px-6 py-2 text-xs"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
              backgroundColor: "var(--surface-1)",
            }}
          >
            <span className="font-medium">Prochains runs :</span>
            {nextRuns.map((iso, i) => (
              <span key={i} className="rounded px-1.5 py-0.5" style={{ backgroundColor: "var(--surface-3)" }}>
                {new Date(iso).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            ))}
          </div>
        )}

        {toast && (
          <div
            className="mx-6 mt-3 rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: "oklch(0.93 0.05 150 / 0.20)", color: "oklch(0.45 0.16 150)" }}
          >
            {toast}
          </div>
        )}

        <RoutineEditor
          routine={routine}
          onSave={handleSave}
          onCancel={() => router.push("/routines")}
          onRunNow={handleRunNow}
        />
      </div>
    </AppShell>
  );
}
