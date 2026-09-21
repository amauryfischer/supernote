"use client";

import { useRouter } from "next/navigation";
import { EmptyState } from "@supernote/ui";
import { FileDashed } from "@phosphor-icons/react";

// L'éditeur vit sur /templates (maître-détail mobile, garde des modifications) : un second ici divergeait.
export function TemplatesTab() {
  const router = useRouter();
  return (
    <EmptyState
      icon={<FileDashed size={28} />}
      title="Modèles de note"
      description="Créez et modifiez vos modèles sur leur page. Ils sont enregistrés dans le coffre et suivent la synchronisation."
      action={{ label: "Ouvrir les modèles", onClick: () => router.push("/templates") }}
    />
  );
}
