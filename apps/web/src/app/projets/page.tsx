"use client";

import { AppShell } from "@/components/shell";
import { Stack } from "@phosphor-icons/react";
import { EmptyState } from "@supernote/ui";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useCallback } from "react";

export default function ProjetsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "projet" });
    },
  });

  const handleNewProject = useCallback(async () => {
    try {
      const entity = await createMutation.mutateAsync({
        typeId: "projet",
        fields: { name: "Nouveau projet" },
      });
      router.push(`/projets/${entity.id}`);
    } catch (err) {
      console.error("[projets] create failed", err);
    }
  }, [createMutation, router]);

  return (
    <AppShell>
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Stack size={28} />}
          title="Aucun projet actif"
          description="Créez votre premier projet pour organiser vos tâches, jalons et membres d'équipe."
          action={{ label: "+ Nouveau projet", onClick: handleNewProject }}
        />
      </div>
    </AppShell>
  );
}
