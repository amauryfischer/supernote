"use client";

import { useParams } from "next/navigation";
import { Spinner } from "@heroui/react";
import { useToast } from "@supernote/ui";
import { AppShell } from "@/components/shell";
import { VariableForm } from "@/components/variables/VariableForm";
import { trpc } from "@/lib/trpc/client";

export default function EditVariablePage() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const { data, isLoading } = trpc.variables.get.useQuery({ id });
  const { data: evaluated } = trpc.variables.evaluate.useQuery({ id });
  const update = trpc.variables.update.useMutation();

  if (isLoading || !data) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <VariableForm
        initial={data}
        submitLabel="Enregistrer"
        evaluatedPreview={evaluated ?? null}
        onSubmit={async (input) => {
          await update.mutateAsync({ id, patch: input });
          await Promise.all([
            utils.variables.get.invalidate({ id }),
            utils.variables.evaluate.invalidate({ id }),
            utils.variables.list.invalidate(),
          ]);
          toast({ title: "Variable enregistrée", variant: "success" });
        }}
      />
    </AppShell>
  );
}
