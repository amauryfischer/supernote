"use client";

import {
  AppShell,
  MobileSheet,
  useMobileTitle,
  useMobileFab,
  useMobileHeaderActions,
  type MobileHeaderAction,
} from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { JournalEditor, JournalSidebar } from "@/components/journal";
import { useRouter, useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CalendarBlank, PencilSimple } from "@phosphor-icons/react";
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
  const isMobile = useIsMobile();
  const today = todayYMD();
  const [selectedDate, setSelectedDate] = useState<string>(date);
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const initialMarkdown = useMemo(() => buildInitialMarkdown(selectedDate), [selectedDate]);

  const handleSelectDate = useCallback((d: string) => {
    setSelectedDate(d);
    setCalendarOpen(false);
    router.push(`/journal/${d}`, { scroll: false });
  }, [router]);

  const handleToday = useCallback(() => {
    setSelectedDate(today);
    setCalendarOpen(false);
    router.push(`/journal/${today}`, { scroll: false });
  }, [router, today]);

  const mobileTitle = useMemo(() => {
    const d = new Date(selectedDate + "T12:00:00");
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  }, [selectedDate]);

  useMobileTitle(isMobile ? mobileTitle : null, isMobile ? "Journal" : null);

  const mobileHeaderActions = useMemo((): MobileHeaderAction[] => {
    if (!isMobile) return [];
    return [
      {
        id: "calendar",
        icon: CalendarBlank,
        label: "Calendrier",
        onPress: () => setCalendarOpen(true),
      },
    ];
  }, [isMobile]);

  useMobileHeaderActions(mobileHeaderActions);

  useMobileFab(
    isMobile
      ? {
          icon: PencilSimple,
          label: "Aujourd'hui",
          onPress: () => router.push(`/journal/${today}`),
        }
      : null,
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar: calendar — desktop only; mobile uses the bottom sheet below */}
      <aside
        className="hidden md:flex flex-col border-r"
        style={{
          width: 240,
          minWidth: 240,
          backgroundColor: "var(--surface-1)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <JournalSidebar
          selectedDate={selectedDate}
          datesWithNote={MOCK_DATES_WITH_NOTE}
          onSelectDate={handleSelectDate}
          onToday={handleToday}
        />
      </aside>
      <main className="flex-1 overflow-hidden" style={{ backgroundColor: "var(--surface-0)" }}>
        <JournalEditor date={selectedDate} initialMarkdown={initialMarkdown} />
      </main>

      {/* Mobile: calendar exposed as a bottom sheet (opened from header action) */}
      <MobileSheet
        isOpen={isCalendarOpen}
        onClose={() => setCalendarOpen(false)}
        title="Calendrier"
        size="md"
      >
        <JournalSidebar
          embedded
          selectedDate={selectedDate}
          datesWithNote={MOCK_DATES_WITH_NOTE}
          onSelectDate={handleSelectDate}
          onToday={handleToday}
        />
      </MobileSheet>
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
