"use client";

import { SectionStub } from "@/components/section-stub";
import { Stack } from "@phosphor-icons/react";

export default function ProjetsPage() {
  return (
    <SectionStub
      icon={Stack}
      title="Projets"
      description="Tous vos projets actifs. Vue kanban par défaut (par statut), avec timeline, dates de début/fin, membres, et notes associées."
      hint="Le schéma Projet est seedé dans packages/db avec workflow idea/active/blocked/done/archived."
    />
  );
}
