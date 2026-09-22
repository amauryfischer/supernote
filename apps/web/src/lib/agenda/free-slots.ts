import type { CalEventRow } from "@supernote/ipc";
import { addDays, startOfDay } from "./dates";

export const SLOT_MIN = 30;
// ponytail: journée de travail en dur (9 h–18 h) ; réglage utilisateur quand l'usage le réclamera.
const WORK_START_MIN = 9 * 60;
const WORK_END_MIN = 18 * 60;
const STEP_MS = 15 * 60_000;
const MAX_DAYS = 14;

export interface FreeSlot {
  startAt: number;
  endAt: number;
}

function atMinute(day: number, min: number): number {
  const d = new Date(day);
  d.setHours(0, min, 0, 0);
  return d.getTime();
}

export function nextFreeSlots(
  events: readonly CalEventRow[],
  now: number,
  count = 3,
  durationMin = SLOT_MIN,
): FreeSlot[] {
  const busy = events.filter((e) => !e.allDay && e.selfResponse !== "declined");
  const duration = durationMin * 60_000;
  const limit = addDays(startOfDay(now), MAX_DAYS);
  const out: FreeSlot[] = [];
  let t = Math.ceil(now / STEP_MS) * STEP_MS;
  while (out.length < count && t < limit) {
    const day = startOfDay(t);
    const open = atMinute(day, WORK_START_MIN);
    if (t < open) {
      t = open;
      continue;
    }
    if (t + duration > atMinute(day, WORK_END_MIN)) {
      t = atMinute(addDays(day, 1), WORK_START_MIN);
      continue;
    }
    const clash = busy.find((e) => e.startAt < t + duration && e.endAt > t);
    if (clash) {
      t = Math.ceil(clash.endAt / STEP_MS) * STEP_MS;
      continue;
    }
    out.push({ startAt: t, endAt: t + duration });
    t += duration;
  }
  return out;
}
