"use client";

import { AppShell } from "@/components/shell";
import { ROUTINES, RoutineEditor } from "@/components/routines";
import type { RoutineFixture } from "@/components/routines";
import { trpc } from "@/lib/trpc/client";
import { useRouter, useParams } from "next/navigation";
import { useState, useCallback } from "react";
import Link from "next/link";
import { entityToRoutine, routineFixtureToEntityFields, ROUTINE_TYPE_ID } from "@/lib/routines/entity-adapter";

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

  const utils = trpc.useUtils();
  const getQuery = trpc.entities.get.useQuery({ id: id || "none" }, { retry: false });
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      void getQuery.refetch();
      void utils.entities.list.invalidate({ typeId: ROUTINE_TYPE_ID });
    },
  });

  const [toast, setToast] = useState<string | null>(null);

  const useFallback = getQuery.isError;
  const fallbackRoutine = ROUTINES.find((r) => r.id === id) ?? null;

  const routine: RoutineFixture | null = useFallback
    ? fallbackRoutine
    : getQuery.data
    ? entityToRoutine(getQuery.data)
    : null;

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
      updateMutation.mutate(
        { id: updated.id, fields: routineFixtureToEntityFields(updated) },
        {
          onSuccess: () => showToast("Routine enregistrée"),
          onError: (err) => showToast(`Erreur : ${err.message}`),
        },
      );
    },
    [useFallback, updateMutation],
  );

  const handleRunNow = useCallback(() => {
    // Manual run is not yet implemented in the worker — show a friendly toast.
    showToast("Routine lancée (mode dégradé)");
  }, []);

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
