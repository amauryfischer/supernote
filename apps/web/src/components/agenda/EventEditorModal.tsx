"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import type { CalCalendarRow } from "@supernote/ipc";
import { X } from "@phosphor-icons/react";
import { Button, Checkbox, Input, Label, Modal, Select, Textarea } from "@supernote/ui";
import { addDays, dateKey, DAY_MS, parseDateKey, startOfDay } from "@/lib/agenda/dates";
import { canEditCalendar } from "./EventBlock";
import type { EventDraft } from "./useEventWrites";

interface EventEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  calendars: CalCalendarRow[];
  /** Brouillon de départ (création) ou valeurs de l'événement (modification). */
  initial: Partial<EventDraft> & { startAt: number; endAt: number };
  mode: "create" | "edit";
  isMobile: boolean;
  onSave: (draft: EventDraft) => Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** `YYYY-MM-DDTHH:mm` sans fuseau est lu en heure locale. */
const localMs = (date: string, time: string) => new Date(`${date}T${time || "00:00"}`).getTime();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EventEditorModal({ isOpen, onClose, calendars, initial, mode, isMobile, onSave }: EventEditorModalProps) {
  const writable = calendars.filter((c) => canEditCalendar(calendars, c.id));
  const defaultCalendar = initial.calendarId ?? (writable.find((c) => c.primary) ?? writable[0])?.id ?? "";

  const [summary, setSummary] = useState("");
  const [calendarId, setCalendarId] = useState(defaultCalendar);
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [attendeeInput, setAttendeeInput] = useState("");
  const [meet, setMeet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Réinitialisé à chaque ouverture : le même composant sert création et modification.
  useEffect(() => {
    if (!isOpen) return;
    const isAllDay = initial.allDay === true;
    setSummary(initial.summary ?? "");
    setCalendarId(defaultCalendar);
    setAllDay(isAllDay);
    setStartDate(dateKey(initial.startAt));
    // Journée entière : la fin Google est exclusive, l'utilisateur voit la date inclusive.
    setEndDate(dateKey(isAllDay ? Math.max(initial.startAt, initial.endAt - DAY_MS) : initial.endAt));
    setStartTime(timeOf(initial.startAt));
    setEndTime(timeOf(initial.endAt));
    setLocation(initial.location ?? "");
    setDescription(initial.description ?? "");
    setAttendees(initial.attendees ?? []);
    setAttendeeInput("");
    setMeet(initial.meet ?? false);
    setError(null);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Liste des agendas arrivée après l'ouverture (mail → événement) : on prend le principal.
  useEffect(() => {
    if (!calendarId && defaultCalendar) setCalendarId(defaultCalendar);
  }, [defaultCalendar]); // eslint-disable-line react-hooks/exhaustive-deps

  const addAttendee = () => {
    const parts = attendeeInput.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    const valid = parts.filter((p) => EMAIL_RE.test(p));
    if (valid.length) setAttendees((prev) => [...new Set([...prev, ...valid])]);
    setAttendeeInput(parts.filter((p) => !EMAIL_RE.test(p)).join(" "));
  };

  const onAttendeeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addAttendee();
    }
  };

  const save = async () => {
    const startAt = allDay ? parseDateKey(startDate) : localMs(startDate, startTime);
    const endAt = allDay ? addDays(parseDateKey(endDate || startDate), 1) : localMs(endDate || startDate, endTime);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
      setError("La fin doit venir après le début.");
      return;
    }
    if (!calendarId) {
      setError("Aucun agenda où tu peux écrire.");
      return;
    }
    const pendingAttendees = attendeeInput.split(/[\s,;]+/).filter((p) => EMAIL_RE.test(p));
    setSaving(true);
    try {
      await onSave({
        calendarId,
        summary: summary.trim(),
        description,
        location: location.trim(),
        allDay,
        startAt: allDay ? startOfDay(startAt) : startAt,
        endAt,
        attendees: [...new Set([...attendees, ...pendingAttendees])],
        meet: mode === "create" && meet,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex w-full items-center justify-end gap-2">
      <Button variant="ghost" onPress={onClose} isDisabled={saving}>
        Annuler
      </Button>
      <Button variant="primary" onPress={() => void save()} isLoading={saving}>
        Enregistrer
      </Button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title={mode === "create" ? "Nouvel événement" : "Modifier l'événement"}
      size={isMobile ? "full" : "md"}
      footer={footer}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          id="agenda-event-title"
          autoFocus
          aria-label="Titre"
          placeholder="Titre de l'événement"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />

        <Checkbox isSelected={allDay} onChange={setAllDay}>
          Journée entière
        </Checkbox>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="agenda-event-start-date">Début</Label>
            <Input id="agenda-event-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            {!allDay && (
              <Input id="agenda-event-start-time" aria-label="Heure de début" type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="agenda-event-end-date">Fin</Label>
            <Input id="agenda-event-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            {!allDay && (
              <Input id="agenda-event-end-time" aria-label="Heure de fin" type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            )}
          </div>
        </div>

        {writable.length > 1 && (
          <Select
            label="Agenda"
            selectedKey={calendarId}
            onSelectionChange={setCalendarId}
            options={writable.map((c) => ({ key: c.id, label: c.summary }))}
          />
        )}

        <Input id="agenda-event-location" aria-label="Lieu" placeholder="Lieu" value={location} onChange={(e) => setLocation(e.target.value)} />

        <div className="flex flex-col gap-1">
          <Label htmlFor="agenda-event-attendees">Invités</Label>
          {attendees.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {attendees.map((email) => (
                <li
                  key={email}
                  className="flex items-center gap-1 rounded-full py-0.5 pl-2 pr-0.5 text-xs"
                  style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                >
                  {email}
                  <button
                    type="button"
                    aria-label={`Retirer ${email}`}
                    onClick={() => setAttendees((prev) => prev.filter((a) => a !== email))}
                    className="flex h-6 w-6 items-center justify-center rounded-full outline-none hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Input
            id="agenda-event-attendees"
            type="email"
            placeholder="e-mail, puis Entrée"
            value={attendeeInput}
            onChange={(e) => setAttendeeInput(e.target.value)}
            onKeyDown={onAttendeeKey}
            onBlur={addAttendee}
          />
        </div>

        <Textarea
          id="agenda-event-description"
          aria-label="Description"
          placeholder="Description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {mode === "create" && (
          <Checkbox isSelected={meet} onChange={setMeet}>
            Ajouter une visio Meet
          </Checkbox>
        )}

        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
