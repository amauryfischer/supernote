"use client";

import type { ComponentProps } from "react";
import { TodayPanel } from "@/components/agenda/TodayPanel";
import { MailAiguillage } from "./MailAiguillage";

/**
 * Volet de droite quand aucun fil n'est ouvert : l'aiguillage (chaque mail sur la voie
 * de son destin), puis la journée si le panneau Aujourd'hui n'est pas déjà ouvert.
 */
export function MailCockpit({ showToday, ...aiguillage }: { showToday: boolean } & ComponentProps<typeof MailAiguillage>) {
  return (
    <div className="@container flex h-full flex-col overflow-y-auto">
      <MailAiguillage {...aiguillage} />
      {showToday && (
        <div className="shrink-0 border-t" style={{ borderColor: "var(--border)" }}>
          <TodayPanel />
        </div>
      )}
    </div>
  );
}
