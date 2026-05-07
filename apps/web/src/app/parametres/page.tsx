"use client";

import { SectionStub } from "@/components/section-stub";
import { Settings } from "lucide-react";

export default function ParametresPage() {
  return (
    <SectionStub
      icon={Settings}
      title="Paramètres"
      description="Configuration : vault, thème, raccourcis, IA (Ollama), automations, sync git, plugins, export/import."
      hint="Page settings complète à venir."
    />
  );
}
