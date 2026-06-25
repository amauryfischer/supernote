"use client";

import { Button } from "@heroui/react";
import { Tag } from "@phosphor-icons/react";
import type { OverlayRow } from "@/lib/mail-overlay";
import type { GmailLabelColor } from "@/lib/gmail";

function shortDate(d: string): string {
  return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "";
}

export function MailOverlayList({
  rows,
  activeKey,
  onPick,
  labelColors,
}: {
  rows: OverlayRow[];
  activeKey?: string;
  onPick: (row: OverlayRow) => void;
  labelColors?: Map<string, GmailLabelColor>;
}) {
  return (
    <div className="flex flex-col gap-1" role="listbox" aria-label="Boîte mail">
      {rows.map((row) => {
        const key = row.kind === "single" ? `t:${row.item.id}` : row.key;
        const title = row.kind === "single" ? row.item.from.name || row.item.from.email : row.title;
        const subject = row.kind === "single" ? row.item.subject : row.items[0]?.subject ?? "";
        const date = row.kind === "single" ? row.item.date : row.date;
        const isLabel = row.kind === "group" && row.groupType === "label";
        const labelId =
          row.kind === "group" && row.groupType === "label" && row.key.startsWith("label:")
            ? row.key.slice("label:".length)
            : null;
        const labelColor = labelId ? labelColors?.get(labelId) : undefined;
        return (
          <Button
            key={key}
            variant={activeKey === key ? "primary" : "ghost"}
            onPress={() => onPick(row)}
            className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
          >
            <span className="flex w-full min-w-0 flex-col gap-0.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {isLabel ? (
                    <span
                      className="inline-flex min-w-0 items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium"
                      style={
                        labelColor
                          ? { backgroundColor: labelColor.backgroundColor, color: labelColor.textColor }
                          : { backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }
                      }
                    >
                      <Tag size={11} aria-hidden />
                      <span className="truncate">{title}</span>
                    </span>
                  ) : (
                    <span className="truncate text-sm font-medium">{title}</span>
                  )}
                  {row.kind === "group" && (
                    <span
                      className="shrink-0 rounded-full px-1.5 text-xs"
                      style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
                    >
                      {row.count}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                  {shortDate(date)}
                </span>
              </span>
              <span className="truncate text-sm" style={{ color: "var(--text-secondary)" }}>
                {subject}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
