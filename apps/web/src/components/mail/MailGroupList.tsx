"use client";

import { Button } from "@heroui/react";
import type { ThreadListItem } from "@/lib/gmail";

function shortDate(d: string): string {
  return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "";
}

export function MailGroupList({
  title,
  items,
  activeThreadId,
  onPick,
}: {
  title: string;
  items: ThreadListItem[];
  activeThreadId?: string;
  onPick: (threadId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {title} · {items.length}
      </p>
      {items.map((it) => (
        <Button
          key={it.id}
          variant={activeThreadId === it.id ? "primary" : "ghost"}
          onPress={() => onPick(it.id)}
          className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
        >
          <span className="flex w-full min-w-0 flex-col gap-0.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium">{it.from.name || it.from.email}</span>
              <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>{shortDate(it.date)}</span>
            </span>
            <span className="truncate text-sm" style={{ color: "var(--text-secondary)" }}>{it.subject}</span>
          </span>
        </Button>
      ))}
    </div>
  );
}
