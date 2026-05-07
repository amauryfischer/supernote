"use client";

import { AppShell } from "@/components/shell";
import { JournalCalendar, JournalEditor } from "@/components/journal";
import { useRouter, useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarBlank } from "@phosphor-icons/react";
import { DAILY_JOURNAL } from "@supernote/templates";

function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T12:00:00"));
}

function buildInitialMarkdown(date: string): string {
  const d = new Date(date + "T12:00:00");
  const formatted = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return DAILY_JOURNAL.body
    .replace(/\{\{date:[^}]+\}\}/g, formatted)
    .replace(/\{\{cursor\}\}/g, "");
}

const MOCK_DATES_WITH_NOTE = new Set<string>([todayYMD()]);

function DateJournalContent({ date }: { date: string }) {
  const router = useRouter();
  const today = todayYMD();
  const [selectedDate, setSelectedDate] = useState<string>(date);
  const initialMarkdown = useMemo(() => buildInitialMarkdown(selectedDate), [selectedDate]);

  const handleSelectDate = (d: string) => {
    setSelectedDate(d);
    router.push(`/journal/${d}`, { scroll: false });
  };

  const handleToday = () => {
    setSelectedDate(today);
    router.push(`/journal/${today}`, { scroll: false });
  };

  return (
    <div className="flex h-full overflow-hidden">
      <aside
        className="flex flex-col border-r"
        style={{
          width: 240,
          minWidth: 240,
          backgroundColor: "var(--surface-1)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <CalendarBlank size={14} style={{ color: "var(--accent)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Journal
            </span>
          </div>
          <button
            onClick={handleToday}
            className="rounded px-2 py-0.5 text-[11px] font-medium transition-colors"
            style={{
              backgroundColor: "var(--accent-subtle)",
              color: "var(--accent)",
            }}
          >
            Aujourd'hui
          </button>
        </div>
        <div className="mt-3">
          <JournalCalendar
            selectedDate={selectedDate}
            datesWithNote={MOCK_DATES_WITH_NOTE}
            onSelectDate={handleSelectDate}
          />
        </div>
      </aside>
      <main className="flex-1 overflow-hidden" style={{ backgroundColor: "var(--surface-0)" }}>
        <JournalEditor date={selectedDate} initialMarkdown={initialMarkdown} />
      </main>
    </div>
  );
}

export default function DateJournalPage() {
  const params = useParams();
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const date = rawDate && isValidDate(rawDate) ? rawDate : todayYMD();

  return (
    <AppShell>
      <DateJournalContent date={date} />
    </AppShell>
  );
}
