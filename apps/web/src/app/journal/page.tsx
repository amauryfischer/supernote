"use client";

import { AppShell } from "@/components/shell";
import { JournalCalendar, JournalEditor } from "@/components/journal";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { CalendarBlank } from "@phosphor-icons/react";
import { DAILY_JOURNAL } from "@supernote/templates";
import { Skeleton, SkeletonText } from "@supernote/ui";

function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Derive the initial markdown for the daily note using the daily journal template body. */
function buildInitialMarkdown(date: string): string {
  const d = new Date(date + "T12:00:00");
  const formatted = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  // Apply the date variable from the template body manually (simple substitution)
  return DAILY_JOURNAL.body
    .replace(/\{\{date:[^}]+\}\}/g, formatted)
    .replace(/\{\{cursor\}\}/g, "");
}

// Mock set of dates that have notes — replace with tRPC query later
const MOCK_DATES_WITH_NOTE = new Set<string>([
  todayYMD(),
]);

function JournalPageContent() {
  const router = useRouter();
  const today = todayYMD();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 250);
    return () => clearTimeout(t);
  }, []);

  const initialMarkdown = useMemo(() => buildInitialMarkdown(selectedDate), [selectedDate]);

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    router.push(`/journal/${date}`, { scroll: false });
  };

  const handleToday = () => {
    setSelectedDate(today);
    router.push(`/journal/${today}`, { scroll: false });
  };

  if (isLoading) {
    return (
      <div className="flex h-full overflow-hidden">
        <div
          className="flex flex-col border-r p-4 gap-3"
          style={{ width: 240, minWidth: 240, backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        >
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="flex-1 p-8">
          <SkeletonText lines={8} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar: calendar */}
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
            className="rounded px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-2)]"
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

      {/* Main editor area */}
      <main
        className="flex-1 overflow-hidden"
        style={{ backgroundColor: "var(--surface-0)" }}
      >
        <JournalEditor date={selectedDate} initialMarkdown={initialMarkdown} />
      </main>
    </div>
  );
}

export default function JournalPage() {
  return (
    <AppShell>
      <JournalPageContent />
    </AppShell>
  );
}
