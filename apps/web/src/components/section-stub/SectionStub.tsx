"use client";

import { AppShell } from "@/components/shell";
import type { Icon } from "@phosphor-icons/react";

interface SectionStubProps {
  icon: Icon;
  title: string;
  description: string;
  hint?: string;
}

/**
 * Generic placeholder used by every nav section that doesn't have its full
 * UI yet. Keeps the navigation usable while subagents implement each module.
 */
export function SectionStub({ icon: Icon, title, description, hint }: SectionStubProps) {
  return (
    <AppShell>
      <div className="mx-auto flex h-full max-w-3xl flex-col items-start px-8 pt-16">
        <div
          className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
        >
          <Icon size={22} />
        </div>
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h1>
        <p
          className="mt-2 max-w-xl text-sm leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          {description}
        </p>
        {hint && (
          <p
            className="mt-6 rounded-md border px-3 py-2 text-xs"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
              backgroundColor: "var(--surface-1)",
            }}
          >
            {hint}
          </p>
        )}
      </div>
    </AppShell>
  );
}
