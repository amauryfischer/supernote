"use client";

import type { ReactNode } from "react";

interface SettingRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    // flex-wrap : un contrôle large (select, chemin) passe sous le libellé
    // quand les deux ne tiennent pas côte à côte ; un interrupteur reste aligné.
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {label}
        </p>
        {description && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {description}
          </p>
        )}
      </div>
      <div className="max-w-full shrink-0">{children}</div>
    </div>
  );
}
