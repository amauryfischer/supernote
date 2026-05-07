"use client";

import { SectionStub } from "@/components/section-stub";
import { Zap } from "lucide-react";

export default function RoutinesPage() {
  return (
    <SectionStub
      icon={Zap}
      title="Routines"
      description="Automations programmables : envoi auto de drafts emails à un contact (hebdo), rappels d'anniversaires, suivi des relances, brief LLM quotidien. Triggers : cron, alarme, événement."
      hint="Engine packages/automations prêt avec 4 routines seed. UI no-code à venir."
    />
  );
}
