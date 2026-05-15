"use client";

import { useRouter } from "next/navigation";
import { VariableForm } from "@/components/variables/VariableForm";
import { trpc } from "@/lib/trpc/client";

export default function NewVariablePage() {
  const router = useRouter();
  const create = trpc.variables.create.useMutation();

  return (
    <VariableForm
      submitLabel="Créer"
      onSubmit={async (input) => {
        const v = await create.mutateAsync(input);
        router.push(`/variables/${v.id}`);
      }}
    />
  );
}
