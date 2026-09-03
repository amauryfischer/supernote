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

  const vaultLabel = vault?.vaultName ?? t("vaultDefault");

  const greetingText =
    clientHour !== null ? greeting(clientHour, t) : t("greetings.morning");

  const fullGreeting = firstName ? `${greetingText}, ${firstName}` : greetingText;

  return (
    <div className="mb-5 flex w-full items-baseline justify-between gap-4">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1
          className="text-[24px] font-semibold leading-tight md:text-[28px]"
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
        className="flex shrink-0 items-center gap-1.5"
        style={{ color: "var(--text-muted)" }}
      >
        <FolderOpen size={14} style={{ color: "var(--icon-decorative)" }} />
        <span className="max-w-[10rem] truncate text-[12px]">{vaultLabel}</span>
      </div>
    </div>
  );
}
