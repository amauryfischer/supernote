import React, { useCallback, useMemo } from "react";
import { Calendar, dateFnsLocalizer, type Event as RBCEvent } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import type { Entity } from "@supernote/core/types";
import type { ViewProps } from "../../types/index.js";
import { queryEntities } from "../../query/index.js";
import { getEntityLabel } from "../../utils/field.js";

const locales = { "en-US": {} as Record<string, unknown> };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

interface CalendarEvent extends RBCEvent {
  entity: Entity;
}

export function CalendarView<T extends Entity = Entity>({
  view,
  entities,
  schema,
  onEntityClick,
}: ViewProps<T>): React.JSX.Element {
  const dateField = view.dateField ?? schema.fields.find(
    (f) => f.kind === "date" || f.kind === "datetime"
  )?.id;

  const processed = useMemo(
    () => queryEntities(entities, view.filters ?? [], view.sort ?? []),
    [entities, view.filters, view.sort]
  );

  const events = useMemo<CalendarEvent[]>(() => {
    if (!dateField) return [];
    return processed.flatMap((entity) => {
      const rawDate = entity.fields[dateField];
      if (!rawDate) return [];
      const start = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
      if (isNaN(start.getTime())) return [];
      return [{
        title: getEntityLabel(entity, schema),
        start,
        end: start,
        allDay: false,
        entity,
      }];
    });
  }, [processed, dateField, schema]);

  const handleSelectEvent = useCallback(
    (event: CalendarEvent) => {
      onEntityClick?.(event.entity as T);
    },
    [onEntityClick]
  );

  return (
    <div
      data-testid="calendar-view"
      style={{ height: "100%", minHeight: 500, padding: 16 }}
    >
      <Calendar<CalendarEvent>
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: "100%" }}
        onSelectEvent={handleSelectEvent}
        views={["month", "week", "day", "agenda"]}
        defaultView="month"
      />
    </div>
  );
}
