"use client";

import { AppShell } from "@/components/shell";
import { TemplatePickerStep, RoutineEditor, getTemplateRoutine } from "@/components/routines";
import type { RoutineFixture, TemplateKey } from "@/components/routines";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";

function NouveauContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateParam = searchParams.get("template") as TemplateKey | null;

  const [step, setStep] = useState<"pick" | "edit">(templateParam ? "edit" : "pick");
  const [routine, setRoutine] = useState<RoutineFixture | null>(() => {
    if (templateParam) {
      return getTemplateRoutine(templateParam, `routine-new-${Date.now()}`);
    }
    return null;
  });

  function handleSelectTemplate(key: TemplateKey) {
    const newRoutine = getTemplateRoutine(key, `routine-new-${Date.now()}`);
    setRoutine(newRoutine);
    setStep("edit");
  }

  function handleSave(saved: RoutineFixture) {
    // In production: tRPC create mutation
    // For now, navigate back with a success state
    router.push("/routines");
  }

  function handleCancel() {
    if (step === "edit" && !templateParam) {
      setStep("pick");
    } else {
      router.push("/routines");
    }
  }

  if (step === "pick") {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
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

        {/* Step 1 content */}
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
      <RoutineEditor
        routine={routine}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return null;
}

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
