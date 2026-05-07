"use client";

import { SectionStub } from "@/components/section-stub";
import { Users } from "lucide-react";

export default function ContactsPage() {
  return (
    <SectionStub
      icon={Users}
      title="Contacts"
      description="Votre CRM personnel : personnes, organisations, relations. Chaque fiche est une note avec champs typés (email, téléphone, anniversaire, etc.) et un body markdown libre."
      hint="Le schéma Personne / Organisation est seedé dans packages/db. La page liste + fiche détail viendra dans la prochaine itération."
    />
  );
}
