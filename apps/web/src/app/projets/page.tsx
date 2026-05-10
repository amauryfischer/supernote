"use client";

import { AppShell, useMobileFab, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Stack, Plus } from "@phosphor-icons/react";
import { EmptyState } from "@supernote/ui";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useCallback } from "react";

export default function ProjetsPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
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

  useMobileTitle(isMobile ? "Projets" : null);
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouveau projet", onPress: () => void handleNewProject() }
      : null,
  );

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
