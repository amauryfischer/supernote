"use client";

import { useParams } from "next/navigation";
import { Spinner } from "@heroui/react";
import { VariableForm } from "@/components/variables/VariableForm";
import { trpc } from "@/lib/trpc/client";

export default function EditVariablePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = trpc.variables.get.useQuery({ id });
  const { data: evaluated } = trpc.variables.evaluate.useQuery({ id });
  const update = trpc.variables.update.useMutation();

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <VariableForm
      initial={data}
      submitLabel="Enregistrer"
      evaluatedPreview={evaluated ?? null}
      onSubmit={async (input) => {
        await update.mutateAsync({ id, patch: input });
      }}
    />
  );
}
