"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FolderOpen } from "@phosphor-icons/react";
import { useVault } from "@/lib/pwa/PwaVaultSetup";

export interface HomeHeroProps {
  firstName?: string;
}

function greeting(hour: number, t: ReturnType<typeof useTranslations>): string {
  if (hour >= 5 && hour < 12) return t("greetings.morning");
  if (hour >= 12 && hour < 18) return t("greetings.afternoon");
  if (hour >= 18 && hour < 23) return t("greetings.evening");
  return t("greetings.night");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function HomeHero({ firstName }: HomeHeroProps) {
  const t = useTranslations("home.hero");
  const vault = useVault();
  const [clientHour, setClientHour] = useState<number | null>(null);
  const [dateLabel, setDateLabel] = useState<string>("");

  useEffect(() => {
    const now = new Date();
    setClientHour(now.getHours());
    setDateLabel(
      capitalize(
        new Intl.DateTimeFormat("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(now),
      ),
    );
  }, []);

  const vaultLabel =
    vault?.vaultName ?? t("vaultDefault");

  const greetingText =
    clientHour !== null
      ? greeting(clientHour, t)
      : t("greetings.morning");

  const fullGreeting = firstName
    ? `${greetingText}, ${firstName}`
    : greetingText;

  return (
    <div className="flex w-full items-start justify-between mb-6">
      <div className="flex flex-col gap-0.5">
        <h1
          className="text-[28px] font-semibold leading-tight"
          style={{ color: "var(--text-primary)" }}
        >
          {fullGreeting}
        </h1>
        {dateLabel && (
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {dateLabel}
          </p>
        )}
      </div>

      <div
        className="flex items-center gap-1 shrink-0 mt-1"
        style={{ color: "var(--text-muted)" }}
      >
        <FolderOpen size={14} />
        <span className="text-[11px]">{vaultLabel}</span>
      </div>
    </div>
  );
}
