"use client";

import type { ReactNode } from "react";

interface SettingSectionProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export function SettingSection({
  title,
  description,
  icon,
  action,
  children,
}: SettingSectionProps) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
    >
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          {icon && (
            <span style={{ color: "var(--accent)" }}>{icon}</span>
          )}
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {title}
            </h3>
            {description && (
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div>{action}</div>}
      </div>
      <div
        className="divide-y"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {children}
      </div>
    </div>
  );
}
