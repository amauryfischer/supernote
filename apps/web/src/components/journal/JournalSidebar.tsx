"use client";

import { Button } from "@heroui/react";
import { CalendarBlank } from "@phosphor-icons/react";
import { JournalCalendar } from "./JournalCalendar";

interface JournalSidebarProps {
  selectedDate: string; // "YYYY-MM-DD"
  datesWithNote: Set<string>;
  onSelectDate: (date: string) => void;
  onToday: () => void;
  /**
   * When true the outer chrome (title row, "Aujourd'hui" button) is dropped so
   * the calendar can be embedded inside a host that already provides a header
   * (e.g. the mobile bottom sheet, whose title bar lives in `MobileSheet`).
   */
  embedded?: boolean;
}

/**
 * Shared journal calendar panel reused by the desktop `<aside>` and the mobile
 * bottom sheet. Keeping a single source avoids duplicating the header + calendar
 * markup across `/journal` and `/journal/[date]`.
 */
export function JournalSidebar({
  selectedDate,
  datesWithNote,
  onSelectDate,
  onToday,
  embedded = false,
}: JournalSidebarProps) {
  return (
    <div className="flex flex-col">
      {!embedded && (
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <CalendarBlank size={14} style={{ color: "var(--accent)" }} />
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Journal
            </span>
          </div>
          <Button
            onPress={onToday}
            size="sm"
            className="rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: "var(--accent-subtle)",
              color: "var(--accent)",
            }}
          >
            Aujourd'hui
          </Button>
        </div>
      )}

      <div className={embedded ? undefined : "mt-3"}>
        {embedded && (
          <div className="mb-2 flex justify-end px-4">
            <Button
              onPress={onToday}
              size="sm"
              className="rounded px-3 py-1 text-xs font-medium"
              style={{
                backgroundColor: "var(--accent-subtle)",
                color: "var(--accent)",
              }}
            >
              Aujourd'hui
            </Button>
          </div>
        )}
        <JournalCalendar
          selectedDate={selectedDate}
          datesWithNote={datesWithNote}
          onSelectDate={onSelectDate}
        />
      </div>
    </div>
  );
}
