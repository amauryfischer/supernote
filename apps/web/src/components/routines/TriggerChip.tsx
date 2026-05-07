"use client";

import { Calendar, Lightning, Alarm, WebhooksLogo } from "@phosphor-icons/react";
import type { TriggerType } from "./fixtures";

interface TriggerChipProps {
  type: TriggerType;
  size?: "sm" | "md";
}

const TRIGGER_CONFIG: Record<
  TriggerType,
  { label: string; icon: React.ElementType; bg: string; color: string }
> = {
  cron: {
    label: "Cron",
    icon: Calendar,
    bg: "oklch(0.93 0.05 295 / 0.18)",
    color: "oklch(0.46 0.22 295)",
  },
  event: {
    label: "Événement",
    icon: Lightning,
    bg: "oklch(0.93 0.10 80 / 0.18)",
    color: "oklch(0.60 0.15 80)",
  },
  alarm: {
    label: "Alarme",
    icon: Alarm,
    bg: "oklch(0.93 0.10 28 / 0.18)",
    color: "oklch(0.55 0.22 28)",
  },
  webhook: {
    label: "Webhook",
    icon: WebhooksLogo,
    bg: "oklch(0.93 0.05 200 / 0.18)",
    color: "oklch(0.50 0.15 200)",
  },
};

export function TriggerChip({ type, size = "sm" }: TriggerChipProps) {
  const cfg = TRIGGER_CONFIG[type];
  const Icon = cfg.icon;
  const iconSize = size === "sm" ? 11 : 13;
  const textClass = size === "sm" ? "text-[10px]" : "text-xs";
  const px = size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${px} ${textClass}`}
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      <Icon size={iconSize} weight="bold" />
      {cfg.label}
    </span>
  );
}
