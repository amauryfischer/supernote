"use client";

import { SectionStub } from "@/components/section-stub";
import { Hash } from "lucide-react";

export default function SchemasPage() {
  return (
    <SectionStub
      icon={Hash}
      title="Schémas"
      description="Tous vos types d'entités. Chaque schéma définit les champs (typés) et les relations possibles. Tu peux créer tes propres types (Livre, Recette, Voyage, Plante…) avec le schema editor."
      hint="Schémas seed : Personne, Organisation, Projet, Interaction, Note, Daily, Account, Asset, Loan, Snapshot, Goal."
    />
  );
}
