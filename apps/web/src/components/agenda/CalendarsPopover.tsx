"use client";

import { useState } from "react";
import { Popover } from "@heroui/react";
import { Stack } from "@phosphor-icons/react";
import { Button, Checkbox, Tooltip } from "@supernote/ui";
import type { CalCalendarRow } from "@supernote/ipc";
import type { CalendarListPatch } from "@/lib/gcal";

// Palette des agendas Google : mêmes teintes que dans Google Agenda.
const PALETTE = [
  "#d06b64", "#f83a22", "#ff7537", "#ffad46", "#fad165", "#16a765",
  "#7bd148", "#42d692", "#9fe1e7", "#4986e7", "#9a9cff", "#b99aff",
  "#cd74e6", "#f691b2", "#ac725e", "#c2c2c2",
];

function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 160 ? "#1d1d1d" : "#ffffff";
}

export function CalendarsPopover({
  calendars,
  onChange,
}: {
  calendars: CalCalendarRow[];
  onChange: (calendarId: string, patch: CalendarListPatch) => void;
}) {
  const [colorFor, setColorFor] = useState<string | null>(null);
  return (
    <Popover onOpenChange={(open) => !open && setColorFor(null)}>
      <Tooltip content="Agendas affichés et couleurs">
        <Button variant="ghost" size="icon" isIconOnly aria-label="Agendas affichés et couleurs">
          <Stack size={16} aria-hidden />
        </Button>
      </Tooltip>
      <Popover.Content className="w-[min(18rem,calc(100vw-2rem))] p-1">
        <Popover.Dialog aria-label="Agendas" className="flex max-h-[70vh] flex-col overflow-y-auto outline-none">
          {calendars.length === 0 && (
            <p className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
              Aucun agenda synchronisé.
            </p>
          )}
          {calendars.map((c) => (
            <div key={c.id} className="flex flex-col">
              <div className="flex min-h-10 items-center gap-2 px-2">
                <Checkbox
                  isSelected={c.selected}
                  onChange={(selected: boolean) => onChange(c.id, { selected })}
                  className="min-w-0 flex-1"
                >
                  <span className="truncate text-sm">{c.summary}</span>
                </Checkbox>
                <Button
                  variant="ghost"
                  size="icon"
                  isIconOnly
                  aria-label={`Couleur de ${c.summary}`}
                  aria-expanded={colorFor === c.id}
                  onPress={() => setColorFor((id) => (id === c.id ? null : c.id))}
                >
                  <span aria-hidden className="h-4 w-4 rounded-full" style={{ background: c.backgroundColor || "var(--accent)" }} />
                </Button>
              </div>
              {colorFor === c.id && (
                <div role="group" aria-label={`Couleurs pour ${c.summary}`} className="grid grid-cols-8 gap-1 px-2 pb-2">
                  {PALETTE.map((hex) => (
                    <Button
                      key={hex}
                      variant="ghost"
                      size="icon"
                      isIconOnly
                      aria-label={hex}
                      aria-pressed={c.backgroundColor.toLowerCase() === hex}
                      className="h-8! w-8! min-w-8! rounded-full! p-0!"
                      style={{ background: hex, outline: c.backgroundColor.toLowerCase() === hex ? "2px solid var(--text-primary)" : undefined, outlineOffset: 2 }}
                      onPress={() => {
                        onChange(c.id, { backgroundColor: hex, foregroundColor: readableOn(hex) });
                        setColorFor(null);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
