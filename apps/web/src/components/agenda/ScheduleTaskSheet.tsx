"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowsLeftRight, CalendarBlank, CalendarX } from "@phosphor-icons/react";
import { Button, Input, Modal } from "@supernote/ui";
import { MobileSheet } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useActionFeedback } from "@/lib/action-feedback";
import { isCalendarConnected } from "@/lib/calendar-sync";
import { dateKey, formatSpan } from "@/lib/agenda/dates";
import { SLOT_MIN, nextFreeSlots } from "@/lib/agenda/free-slots";
import { TaskList } from "./TaskDrawer";
import { useEventWrites } from "./useEventWrites";
import { useScheduledBlocks } from "./useScheduledBlocks";
import type { SchedulableTask } from "./useSchedulableTasks";

export interface TaskTarget {
  ref: string;
  title: string;
}

interface ScheduleTaskSheetProps {
  task: TaskTarget | null;
  pickFrom?: readonly SchedulableTask[];
  onClose: () => void;
}

const DAY_SHORT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const DURATIONS = [30, 60, 120] as const;

function slotLabel(s: { startAt: number; endAt: number }): string {
  return `${DAY_SHORT.format(s.startAt)} · ${formatSpan({ allDay: false, ...s })}`;
}

export function ScheduleTaskSheet({ task: initialTask, pickFrom = [], onClose }: ScheduleTaskSheetProps) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { accountId, events, blocks } = useScheduledBlocks();
  const writes = useEventWrites(accountId);
  const feedback = useActionFeedback();
  const [task, setTask] = useState(initialTask);
  const [moving, setMoving] = useState(false);
  const [now] = useState(() => Date.now());
  const [date, setDate] = useState(() => dateKey(now));
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState<number>(SLOT_MIN);
  const slots = useMemo(() => nextFreeSlots(events, now), [events, now]);
  const block = task ? (blocks.get(task.ref) ?? null) : null;
  const connected = !!accountId && isCalendarConnected();

  const place = (startAt: number, endAt: number) =>
    void feedback.run(async () => {
      if (!task) return;
      if (block) await writes.move(block, startAt, endAt);
      else await writes.scheduleTask({ ref: task.ref, title: task.title, startAt, endAt });
      onClose();
    });

  const placeCustom = () => {
    const startAt = new Date(`${date}T${time || "09:00"}`).getTime();
    if (!Number.isFinite(startAt)) {
      feedback.fail(new Error("Date ou heure invalide."));
      return;
    }
    place(startAt, startAt + duration * 60_000);
  };

  let content: ReactNode;
  if (!connected) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Connecte Google Agenda pour planifier.
        </p>
        <Button
          variant="outline"
          size="sm"
          onPress={() => {
            onClose();
            navigate("/agenda");
          }}
        >
          <CalendarBlank size={14} aria-hidden />
          Ouvrir l'agenda
        </Button>
      </div>
    );
  } else if (!task) {
    content =
      pickFrom.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Tout est planifié.
        </p>
      ) : (
        <TaskList tasks={pickFrom} onPick={(t) => setTask({ ref: t.ref, title: t.title })} />
      );
  } else if (block && !moving) {
    content = (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {task.title}
        </p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Planifié {slotLabel(block)}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onPress={() => setMoving(true)}>
            <ArrowsLeftRight size={14} aria-hidden />
            Déplacer
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={feedback.isPending}
            onPress={() =>
              void feedback.run(async () => {
                await writes.remove(block);
                onClose();
              })
            }
          >
            <CalendarX size={14} aria-hidden />
            Retirer du planning
          </Button>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {task.title}
        </p>
        <div role="group" aria-label="Prochains créneaux libres" className="flex flex-col gap-1.5">
          <span aria-hidden className="sn-eyebrow sn-eyebrow--compact">
            Prochains créneaux libres
          </span>
          {slots.map((s) => (
            <Button
              key={s.startAt}
              variant="outline"
              isDisabled={feedback.isPending}
              onPress={() => place(s.startAt, s.endAt)}
              className="justify-start"
            >
              {slotLabel(s)}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <span className="sn-eyebrow sn-eyebrow--compact">Autre créneau</span>
          <div className="grid grid-cols-2 gap-2">
            <Input id="schedule-task-date" aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input id="schedule-task-time" aria-label="Heure de début" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div role="group" aria-label="Durée" className="flex gap-1.5">
            {DURATIONS.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={duration === d ? "primary" : "outline"}
                aria-pressed={duration === d}
                onPress={() => setDuration(d)}
              >
                {d < 60 ? `${d} min` : `${d / 60} h`}
              </Button>
            ))}
          </div>
          <Button variant="primary" isLoading={feedback.isPending} onPress={placeCustom}>
            Planifier
          </Button>
        </div>
      </div>
    );
  }

  const body = (
    <>
      {content}
      {feedback.error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {feedback.error}
        </p>
      )}
    </>
  );

  return isMobile ? (
    <MobileSheet isOpen onClose={onClose} title="Planifier" size="lg">
      {body}
    </MobileSheet>
  ) : (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title="Planifier" size="sm">
      {body}
    </Modal>
  );
}
