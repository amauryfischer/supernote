"use client";

import { SectionStub } from "@/components/section-stub";
import { Gear } from "@phosphor-icons/react";

export default function ParametresPage() {
  return (
    <SectionStub
      icon={Gear}
      title="Paramètres"
      description="Configuration : vault, thème, raccourcis, IA (Ollama), automations, sync git, plugins, export/import."
      hint="Page settings complète à venir."
    />
  );
}
