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
import { useDatesWithNote } from "@/hooks/useDatesWithNote";
import { JournalEditor, JournalSidebar } from "@/components/journal";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useEffect } from "react";
import { CalendarBlank, PencilSimple } from "@phosphor-icons/react";
import { Skeleton, SkeletonText } from "@supernote/ui";

function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function JournalPageContent() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const today = todayYMD();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [isLoading, setIsLoading] = useState(true);
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  // Vraies dates avec entrée de journal (entités `daily`), pour pastiller le
  // calendrier. Dégrade en ensemble vide si le backend ne répond pas.
  const { datesWithNote } = useDatesWithNote();

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setCalendarOpen(false);
    router.push(`/journal/${date}`, { scroll: false });
  }, [router]);

  const handleToday = useCallback(() => {
    setSelectedDate(today);
    setCalendarOpen(false);
    router.push(`/journal/${today}`, { scroll: false });
  }, [router, today]);

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 250);
    return () => clearTimeout(t);
  }, []);

  // Format selected date for mobile title
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
          label: "Écrire",
          onPress: () => router.push(`/journal/${today}`),
        }
      : null,
  );

  if (isLoading) {
    return (
      <div className="flex h-full overflow-hidden">
        <div
          className="hidden md:flex flex-col border-r p-4 gap-3"
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
          datesWithNote={datesWithNote}
          onSelectDate={handleSelectDate}
          onToday={handleToday}
        />
      </aside>

      {/* Main editor area */}
      <main
        className="flex-1 overflow-hidden"
        style={{ backgroundColor: "var(--surface-0)" }}
      >
        <JournalEditor date={selectedDate} />
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
          datesWithNote={datesWithNote}
          onSelectDate={handleSelectDate}
          onToday={handleToday}
        />
      </MobileSheet>
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
