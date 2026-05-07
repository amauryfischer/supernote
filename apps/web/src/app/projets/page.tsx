"use client";

import { SectionStub } from "@/components/section-stub";
import { Layers } from "lucide-react";

export default function ProjetsPage() {
  return (
    <SectionStub
      icon={Layers}
      title="Projets"
      description="Tous vos projets actifs. Vue kanban par défaut (par statut), avec timeline, dates de début/fin, membres, et notes associées."
      hint="Le schéma Projet est seedé dans packages/db avec workflow idea/active/blocked/done/archived."
    />
  );
}
