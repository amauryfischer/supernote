"use client";

import { TodayPanel } from "@/components/agenda/TodayPanel";

/**
 * Volet de droite quand aucun fil n'est ouvert : la journée (agenda, je dois / on me
 * doit). « À toi de répondre » vit en tête de liste, pas ici, pour ne pas le lire deux fois.
 */
export function MailCockpit({ showToday }: { showToday: boolean }) {
  if (!showToday) return null;
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <TodayPanel />
    </div>
  );
}
