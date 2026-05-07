"use client";

import { SectionStub } from "@/components/section-stub";
import { FileText } from "lucide-react";

export default function NotesPage() {
  return (
    <SectionStub
      icon={FileText}
      title="Notes"
      description="Toutes vos notes libres et documents. Bientôt : navigation par dossier, vues table/galerie/kanban, filtres composables, et l'éditeur block-based plein écran."
      hint="L'agent packages/editor (BlockNote + blocs custom) finit de scaffolder l'éditeur. Les notes que tu crées depuis l'accueil seront listées ici."
    />
  );
}
