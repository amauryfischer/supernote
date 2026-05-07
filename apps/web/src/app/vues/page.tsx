"use client";

import { SectionStub } from "@/components/section-stub";
import { BookOpen } from "lucide-react";

export default function VuesPage() {
  return (
    <SectionStub
      icon={BookOpen}
      title="Vues"
      description="Vues sauvegardées : table, kanban, galerie, calendrier, timeline, graphe. Construites sur des requêtes filtrables (path: type: tag: field: created: modified: relation:)."
      hint="Persistées dans .supernote/views/."
    />
  );
}
