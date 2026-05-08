"use client";

import { AppShell } from "@/components/shell";
import { TemplatePickerStep, RoutineEditor, getTemplateRoutine } from "@/components/routines";
import type { RoutineFixture, TemplateKey } from "@/components/routines";
import { trpc } from "@/lib/trpc/client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, Suspense } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { routineFixtureToEntityFields, ROUTINE_TYPE_ID } from "@/lib/routines/entity-adapter";

// ── Inner content (needs Suspense for useSearchParams) ────────────────────

function NouveauContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateParam = searchParams.get("template") as TemplateKey | null;

  const utils = trpc.useUtils();
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: (entity) => {
      void utils.entities.list.invalidate({ typeId: ROUTINE_TYPE_ID });
      router.push(`/routines/${entity.id}`);
    },
    onError: (err) => setError(err.message),
  });

  const [step, setStep] = useState<"pick" | "edit">(templateParam ? "edit" : "pick");
  const [routine, setRoutine] = useState<RoutineFixture | null>(() =>
    templateParam ? getTemplateRoutine(templateParam, `routine-new-${Date.now()}`) : null,
  );
  const [error, setError] = useState<string | null>(null);

  const handleSelectTemplate = useCallback((key: TemplateKey) => {
    setRoutine(getTemplateRoutine(key, `routine-new-${Date.now()}`));
    setStep("edit");
  }, []);

  const handleSave = useCallback((saved: RoutineFixture) => {
    setError(null);
    if (createMutation.isPending) return;
    try {
      createMutation.mutate({
        typeId: ROUTINE_TYPE_ID,
        fields: routineFixtureToEntityFields(saved),
      });
    } catch {
      // Fallback: just navigate back if IPC unavailable
      router.push("/routines");
    }
  }, [createMutation, router]);

  const handleCancel = useCallback(() => {
    if (step === "edit" && !templateParam) {
      setStep("pick");
    } else {
      router.push("/routines");
    }
  }, [step, templateParam, router]);

  if (step === "pick") {
    return (
      <div className="flex h-full flex-col">
        <div
          className="flex items-center gap-3 border-b px-6 py-3"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
        >
          <Link
            href="/routines"
            className="flex items-center gap-1 rounded p-1 text-xs transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={14} />
            Routines
          </Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Nouvelle routine
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto max-w-xl">
            <TemplatePickerStep onSelect={handleSelectTemplate} />
          </div>
        </div>
      </div>
    );
  }

  if (step === "edit" && routine) {
    return (
      <div className="flex h-full flex-col">
        {error && (
          <div
            className="mx-6 mt-3 rounded-md px-4 py-2 text-sm"
            style={{ backgroundColor: "oklch(0.93 0.10 28 / 0.15)", color: "var(--danger)" }}
          >
            {error}
          </div>
        )}
        <RoutineEditor
          routine={routine}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  return null;
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function NouveauRoutinePage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement…</span>
          </div>
        }
      >
        <NouveauContent />
      </Suspense>
    </AppShell>
  );
}
