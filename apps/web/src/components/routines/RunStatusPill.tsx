"use client";

import type { RunStatus } from "./fixtures";

interface RunStatusPillProps {
  status: RunStatus;
}

const STATUS_CONFIG: Record<RunStatus, { label: string; bg: string; color: string }> = {
  SUCCESS: { label: "Succès", bg: "oklch(0.93 0.05 150 / 0.20)", color: "oklch(0.45 0.16 150)" },
  FAILURE: { label: "Échec", bg: "oklch(0.93 0.10 28 / 0.20)", color: "oklch(0.50 0.22 28)" },
  SKIPPED: { label: "Ignoré", bg: "oklch(0.93 0.01 260 / 0.20)", color: "oklch(0.55 0.008 260)" },
  RUNNING: { label: "En cours", bg: "oklch(0.93 0.05 200 / 0.20)", color: "oklch(0.50 0.15 200)" },
};

export function RunStatusPill({ status }: RunStatusPillProps) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}
