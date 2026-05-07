"use client";

import { AppShell } from "@/components/shell";
import { Stack } from "@phosphor-icons/react";
import { EmptyState } from "@supernote/ui";

export default function ProjetsPage() {
  return (
    <AppShell>
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Stack size={28} />}
          title="Aucun projet actif"
          description="Créez votre premier projet pour organiser vos tâches, jalons et membres d'équipe."
          action={{ label: "+ Nouveau projet", onClick: () => alert("Créer un projet (à implémenter)") }}
        />
      </div>
    </AppShell>
  );
}
