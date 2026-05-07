"use client";

import { AppShell } from "@/components/shell";
import { ROUTINES, RoutineEditor } from "@/components/routines";
import type { RoutineFixture } from "@/components/routines";
import { useRouter, useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

export default function RoutineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";

  const [routine, setRoutine] = useState<RoutineFixture | null>(() => {
    return ROUTINES.find((r) => r.id === id) ?? null;
  });

  if (!routine) {
    return (
      <AppShell>
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Routine introuvable : <code className="rounded px-1" style={{ backgroundColor: "var(--surface-2)" }}>{id}</code>
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

  function handleSave(updated: RoutineFixture) {
    setRoutine(updated);
    // In production, this would call a tRPC mutation
  }

  function handleCancel() {
    router.push("/routines");
  }

  function handleRunNow() {
    alert(`Lancement de la routine "${routine?.name}"…\n\n(mock — pas de backend)`);
  }

  return (
    <AppShell>
      <RoutineEditor
        routine={routine}
        onSave={handleSave}
        onCancel={handleCancel}
        onRunNow={handleRunNow}
      />
    </AppShell>
  );
}
