"use client";

import { SectionStub } from "@/components/section-stub";
import { Calendar } from "lucide-react";

export default function JournalPage() {
  return (
    <SectionStub
      icon={Calendar}
      title="Journal"
      description="Une note par jour. Bouton 'Aujourd'hui' toujours accessible, navigation par calendrier, templates personnalisables avec variables."
      hint="Type seed Daily, fichiers stockés dans /Daily/YYYY/MM-DD.md."
    />
  );
}
