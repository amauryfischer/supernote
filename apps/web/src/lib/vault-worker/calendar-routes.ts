/**
 * Routes `calendar.*` : miroir local de Google Agenda (tables `cal_*`). Le
 * réseau Google se fait sur le thread principal (`lib/calendar-sync.ts`) ; ici
 * on range ce qu'il envoie, on sert les lectures et on tient la file d'écriture.
 */

import type {
  CalendarAccountInput,
  CalendarApplyLocalMutationInput,
  CalendarListEventsInput,
  CalendarOverlayInput,
  CalendarResolveOutboxInput,
  CalendarSyncUpsertInput,
  CalEventInput,
  CalEventRow,
  CalOverlayItem,
  PushUpcomingEvent,
  PushUpcomingInput,
  PushUpcomingReminder,
} from "@supernote/ipc";
import type { Database } from "./sqlite-adapter";
import type { RouteHandler } from "./worker-router";
import { row, rows, runInTransaction, type SqlRow } from "./sql";

const MAX_ATTEMPTS = 5;

const UPSERT_EVENT = `INSERT INTO cal_event
  (accountId, calendarId, id, summary, description, location, startAt, endAt, allDay, startDate, endDate,
   status, recurringEventId, htmlLink, meetUrl, attendeesJson, selfResponse, etag, colorId, sourceRef, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(accountId, calendarId, id) DO UPDATE SET
    summary = excluded.summary, description = excluded.description, location = excluded.location,
    startAt = excluded.startAt, endAt = excluded.endAt, allDay = excluded.allDay,
    startDate = excluded.startDate, endDate = excluded.endDate, status = excluded.status,
    recurringEventId = excluded.recurringEventId, htmlLink = excluded.htmlLink, meetUrl = excluded.meetUrl,
    attendeesJson = excluded.attendeesJson, selfResponse = excluded.selfResponse, etag = excluded.etag,
    colorId = excluded.colorId, sourceRef = excluded.sourceRef, updatedAt = excluded.updatedAt`;

function eventParams(accountId: string, e: CalEventInput, ts: number): (string | number)[] {
  return [
    accountId, e.calendarId, e.id, e.summary, e.description, e.location, e.startAt, e.endAt,
    e.allDay ? 1 : 0, e.startDate, e.endDate, e.status, e.recurringEventId, e.htmlLink, e.meetUrl,
    JSON.stringify(e.attendees), e.selfResponse, e.etag, e.colorId, e.sourceRef, ts,
  ];
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toEventRow(r: SqlRow): CalEventRow {
  return {
    calendarId: String(r["calendarId"]),
    id: String(r["id"]),
    summary: String(r["summary"] ?? ""),
    description: String(r["description"] ?? ""),
    location: String(r["location"] ?? ""),
    startAt: Number(r["startAt"]),
    endAt: Number(r["endAt"]),
    allDay: Number(r["allDay"]) === 1,
    startDate: String(r["startDate"] ?? ""),
    endDate: String(r["endDate"] ?? ""),
    status: String(r["status"] ?? ""),
    recurringEventId: String(r["recurringEventId"] ?? ""),
    htmlLink: String(r["htmlLink"] ?? ""),
    meetUrl: String(r["meetUrl"] ?? ""),
    attendees: parseJson(r["attendeesJson"], []),
    selfResponse: String(r["selfResponse"] ?? ""),
    etag: String(r["etag"] ?? ""),
    colorId: String(r["colorId"] ?? ""),
    sourceRef: String(r["sourceRef"] ?? ""),
    pending: Number(r["pending"]) === 1,
    noteId: typeof r["noteId"] === "string" ? r["noteId"] : null,
  };
}

/** Titre lisible d'une entité de base : champ titre/nom connu, sinon premier texte court. */
function entityTitle(fields: Record<string, unknown>, fallback: string): string {
  for (const key of ["title", "name", "per_name"]) {
    const v = fields[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const first = Object.values(fields).find((v) => typeof v === "string" && v.trim() && v.length < 120);
  return typeof first === "string" ? first.trim() : fallback;
}

export function buildCalendarRoutes(db: Database, vaultId: string): Record<string, RouteHandler> {
  const syncUpsert = async (input: unknown): Promise<unknown> => {
    const { accountId, calendars, replaceWindows, events, removals, states } = input as CalendarSyncUpsertInput;
    const ts = Date.now();
    return runInTransaction(db, () => {
      let removed = 0;
      for (const c of calendars ?? []) {
        db.run(
          `INSERT INTO cal_calendar
             (accountId, id, summary, backgroundColor, foregroundColor, selected, isPrimary, accessRole, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(accountId, id) DO UPDATE SET summary = excluded.summary,
             backgroundColor = excluded.backgroundColor, foregroundColor = excluded.foregroundColor,
             selected = excluded.selected, isPrimary = excluded.isPrimary, accessRole = excluded.accessRole,
             updatedAt = excluded.updatedAt`,
          [accountId, c.id, c.summary, c.backgroundColor, c.foregroundColor, c.selected ? 1 : 0, c.primary ? 1 : 0, c.accessRole, ts],
        );
      }
      if (calendars) {
        // Un agenda retiré du compte emporte ses événements.
        const keep = new Set(calendars.map((c) => c.id));
        for (const r of rows(db.exec(`SELECT id FROM cal_calendar WHERE accountId = ?`, [accountId]))) {
          const id = String(r["id"]);
          if (keep.has(id)) continue;
          db.run(`DELETE FROM cal_calendar WHERE accountId = ? AND id = ?`, [accountId, id]);
          db.run(`DELETE FROM cal_event WHERE accountId = ? AND calendarId = ?`, [accountId, id]);
          db.run(`DELETE FROM cal_sync_state WHERE accountId = ? AND calendarId = ?`, [accountId, id]);
        }
      }
      for (const w of replaceWindows ?? []) {
        // Une écriture encore en file garde sa ligne : Google ne la connaît pas encore.
        db.run(
          `DELETE FROM cal_event WHERE accountId = ? AND calendarId = ? AND endAt >= ? AND startAt <= ?
             AND id NOT IN (SELECT eventId FROM cal_outbox WHERE accountId = ? AND status = 'pending')`,
          [accountId, w.calendarId, w.from, w.to, accountId],
        );
      }
      for (const e of events ?? []) db.run(UPSERT_EVENT, eventParams(accountId, e, ts));
      for (const r of removals ?? []) {
        db.run(`DELETE FROM cal_event WHERE accountId = ? AND calendarId = ? AND id = ?`, [accountId, r.calendarId, r.id]);
        removed++;
      }
      for (const s of states ?? []) {
        db.run(
          `INSERT INTO cal_sync_state
             (accountId, calendarId, updatedMin, windowStart, windowEnd, lastFullSyncAt, lastSyncAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(accountId, calendarId) DO UPDATE SET updatedMin = excluded.updatedMin,
             windowStart = excluded.windowStart, windowEnd = excluded.windowEnd,
             lastFullSyncAt = CASE WHEN ? = 1 THEN excluded.lastSyncAt ELSE cal_sync_state.lastFullSyncAt END,
             lastSyncAt = excluded.lastSyncAt`,
          [accountId, s.calendarId, s.updatedMin, s.windowStart, s.windowEnd, s.fullSync ? ts : 0, ts, s.fullSync ? 1 : 0],
        );
      }
      return { events: events?.length ?? 0, removed };
    });
  };

  const listEvents = async (input: unknown): Promise<unknown> => {
    const { accountId, from, to } = input as CalendarListEventsInput;
    const res = db.exec(
      `SELECT e.*,
          (SELECT n.id FROM entity n WHERE n.vaultId = ? AND n.typeId = 'note'
             AND json_extract(n.fields, '$.gcalEventId') = e.id LIMIT 1) AS noteId,
          EXISTS (SELECT 1 FROM cal_outbox o WHERE o.accountId = e.accountId AND o.eventId = e.id
                    AND o.status = 'pending') AS pending
         FROM cal_event e
         JOIN cal_calendar c ON c.accountId = e.accountId AND c.id = e.calendarId
        WHERE e.accountId = ? AND c.selected = 1 AND e.status != 'cancelled'
          AND e.endAt >= ? AND e.startAt <= ?
        ORDER BY e.startAt ASC`,
      [vaultId, accountId, from, to],
    );
    return { events: rows(res).map(toEventRow) };
  };

  const listCalendars = async (input: unknown): Promise<unknown> => {
    const { accountId } = input as CalendarAccountInput;
    const res = db.exec(
      `SELECT * FROM cal_calendar WHERE accountId = ? ORDER BY isPrimary DESC, summary`,
      [accountId],
    );
    return {
      calendars: rows(res).map((r) => ({
        id: String(r["id"]),
        summary: String(r["summary"] ?? ""),
        backgroundColor: String(r["backgroundColor"] ?? ""),
        foregroundColor: String(r["foregroundColor"] ?? ""),
        selected: Number(r["selected"]) === 1,
        primary: Number(r["isPrimary"]) === 1,
        accessRole: String(r["accessRole"] ?? "reader"),
      })),
    };
  };

  const getState = async (input: unknown): Promise<unknown> => {
    const { accountId } = input as CalendarAccountInput;
    const res = db.exec(`SELECT * FROM cal_sync_state WHERE accountId = ?`, [accountId]);
    return {
      states: rows(res).map((r) => ({
        calendarId: String(r["calendarId"]),
        updatedMin: String(r["updatedMin"] ?? ""),
        windowStart: Number(r["windowStart"]) || 0,
        windowEnd: Number(r["windowEnd"]) || 0,
        lastFullSyncAt: Number(r["lastFullSyncAt"]) || 0,
        lastSyncAt: Number(r["lastSyncAt"]) || 0,
      })),
    };
  };

  const applyLocalMutation = async (input: unknown): Promise<unknown> => {
    const m = input as CalendarApplyLocalMutationInput;
    const ts = Date.now();
    return runInTransaction(db, () => {
      if (m.kind === "delete") {
        db.run(`DELETE FROM cal_event WHERE accountId = ? AND calendarId = ? AND id = ?`, [m.accountId, m.calendarId, m.eventId]);
      } else if (m.event) {
        db.run(UPSERT_EVENT, eventParams(m.accountId, m.event, ts));
      }
      db.run(
        `INSERT INTO cal_outbox (opId, accountId, calendarId, eventId, kind, payloadJson, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [m.opId, m.accountId, m.calendarId, m.eventId, m.kind, JSON.stringify(m.payload), ts],
      );
      return { ok: true };
    });
  };

  const listOutbox = async (input: unknown): Promise<unknown> => {
    const { accountId } = input as CalendarAccountInput;
    const res = db.exec(
      `SELECT * FROM cal_outbox WHERE accountId = ? AND status = 'pending' ORDER BY createdAt ASC`,
      [accountId],
    );
    return {
      items: rows(res).map((r) => ({
        opId: String(r["opId"]),
        calendarId: String(r["calendarId"]),
        eventId: String(r["eventId"]),
        kind: String(r["kind"]),
        payload: parseJson<Record<string, unknown>>(r["payloadJson"], {}),
        attempts: Number(r["attempts"]) || 0,
        nextAttemptAt: Number(r["nextAttemptAt"]) || 0,
        createdAt: Number(r["createdAt"]) || 0,
      })),
    };
  };

  const resolveOutbox = async (input: unknown): Promise<unknown> => {
    const r = input as CalendarResolveOutboxInput;
    const op = row(db.exec(`SELECT calendarId, eventId FROM cal_outbox WHERE opId = ?`, [r.opId]));
    if (!op) return { ok: false };
    const calendarId = String(op["calendarId"]);
    const localId = String(op["eventId"]);
    const ts = Date.now();
    return runInTransaction(db, () => {
      if (r.outcome === "fail") {
        db.run(
          `UPDATE cal_outbox SET attempts = attempts + 1, lastError = ?, nextAttemptAt = ?,
             status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
           WHERE opId = ?`,
          [r.error ?? "", r.nextAttemptAt ?? 0, MAX_ATTEMPTS, r.opId],
        );
        return { ok: true };
      }
      db.run(`DELETE FROM cal_outbox WHERE opId = ?`, [r.opId]);
      if (r.event) {
        if (r.event.id !== localId) {
          // Création acquittée : l'id provisoire cède la place à l'id Google, y compris dans les ops suivantes.
          db.run(`DELETE FROM cal_event WHERE accountId = ? AND calendarId = ? AND id = ?`, [r.accountId, calendarId, localId]);
          db.run(`UPDATE cal_outbox SET eventId = ? WHERE accountId = ? AND eventId = ?`, [r.event.id, r.accountId, localId]);
        }
        db.run(UPSERT_EVENT, eventParams(r.accountId, r.event, ts));
        // Les modifications suivantes du même événement partent avec l'etag frais,
        // sans quoi Google les refuserait en 412 comme un faux conflit.
        db.run(
          `UPDATE cal_outbox SET payloadJson = json_set(payloadJson, '$.etag', ?)
            WHERE accountId = ? AND eventId = ? AND status = 'pending' AND kind IN ('patch', 'rsvp')`,
          [r.event.etag, r.accountId, r.event.id],
        );
      }
      return { ok: true };
    });
  };

  const clear = async (input: unknown): Promise<unknown> => {
    const { accountId } = input as CalendarAccountInput;
    runInTransaction(db, () => {
      for (const table of ["cal_event", "cal_calendar", "cal_sync_state", "cal_outbox"]) {
        db.run(`DELETE FROM ${table} WHERE accountId = ?`, [accountId]);
      }
    });
    return { ok: true };
  };

  const overlay = async (input: unknown): Promise<unknown> => {
    const { from, to } = input as CalendarOverlayInput;
    const items: CalOverlayItem[] = [];
    const todos = rows(db.exec(
      `SELECT id, fields FROM entity WHERE vaultId = ? AND typeId = 'todo'
         AND substr(COALESCE(json_extract(fields, '$.dueDate'), json_extract(fields, '$.startDate')), 1, 10)
             BETWEEN ? AND ?`,
      [vaultId, from, to],
    ));
    for (const t of todos) {
      const f = parseJson<Record<string, unknown>>(t["fields"], {});
      if (f["done"] === true || f["done"] === "true") continue;
      // Anciennes tâches projetées depuis une note : la checklist de la note fait foi.
      if (typeof f["sourceNoteId"] === "string" && f["sourceNoteId"]) continue;
      items.push({
        kind: "todo",
        entityId: String(t["id"]),
        typeId: "todo",
        typeName: "Todo",
        fieldLabel: "Échéance",
        title: typeof f["text"] === "string" && f["text"] ? f["text"] : "(sans texte)",
        date: String(f["dueDate"] ?? f["startDate"] ?? "").slice(0, 10),
      });
    }
    const types = rows(db.exec(
      `SELECT id, name, fields FROM entity_type
        WHERE vaultId = ? AND id NOT IN ('todo', 'note', 'template', 'vault_mount')`,
      [vaultId],
    ));
    for (const t of types) {
      const defs = parseJson<Array<{ id?: string; name?: string; label?: string; type?: string; kind?: string }>>(t["fields"], []);
      for (const d of defs) {
        if ((d.type ?? d.kind) !== "date") continue;
        const key = d.id || d.name;
        if (!key) continue;
        const res = db.exec(
          `SELECT id, fields FROM entity WHERE vaultId = ? AND typeId = ?
             AND substr(json_extract(fields, '$."' || ? || '"'), 1, 10) BETWEEN ? AND ?`,
          [vaultId, String(t["id"]), key, from, to],
        );
        for (const e of rows(res)) {
          const f = parseJson<Record<string, unknown>>(e["fields"], {});
          items.push({
            kind: "base",
            entityId: String(e["id"]),
            typeId: String(t["id"]),
            typeName: String(t["name"] ?? ""),
            fieldLabel: d.label ?? d.name ?? key,
            title: entityTitle(f, String(t["name"] ?? "")),
            date: String(f[key] ?? "").slice(0, 10),
          });
        }
      }
    }
    return { items };
  };

  const pushUpcoming = async (input: unknown): Promise<unknown> => {
    const { from, to, accountId } = input as PushUpcomingInput;
    const reminders: PushUpcomingReminder[] = [];
    const todos = rows(db.exec(
      `SELECT id, fields FROM entity WHERE vaultId = ? AND typeId = 'todo'
         AND COALESCE(json_extract(fields, '$.reminderAt'), '') != ''
         AND COALESCE(json_extract(fields, '$.reminderFiredAt'), '') = ''`,
      [vaultId],
    ));
    for (const t of todos) {
      const f = parseJson<Record<string, unknown>>(t["fields"], {});
      if (f["done"] === true || f["done"] === "true") continue;
      // datetime-local sans fuseau : lu à l'heure locale de l'appareil.
      const reminderAt = new Date(String(f["reminderAt"])).getTime();
      if (!(reminderAt >= from && reminderAt <= to)) continue;
      reminders.push({
        todoId: String(t["id"]),
        reminderAt,
        text: typeof f["text"] === "string" ? f["text"] : "",
        reminderText: typeof f["reminderText"] === "string" ? f["reminderText"].trim() : "",
      });
    }
    reminders.sort((a, b) => a.reminderAt - b.reminderAt);
    // e.* : `sourceRef` n'existe qu'après la migration de « Planifier ses todos ».
    const events: PushUpcomingEvent[] = accountId
      ? rows(db.exec(
          `SELECT e.* FROM cal_event e
             JOIN cal_calendar c ON c.accountId = e.accountId AND c.id = e.calendarId
            WHERE e.accountId = ? AND c.selected = 1 AND e.status != 'cancelled' AND e.allDay = 0
              AND e.selfResponse != 'declined' AND e.startAt >= ? AND e.startAt <= ?
            ORDER BY e.startAt ASC`,
          [accountId, from, to],
        )).map((e) => ({
          calendarId: String(e["calendarId"]),
          eventId: String(e["id"]),
          summary: String(e["summary"] ?? ""),
          startAt: Number(e["startAt"]),
          meetUrl: String(e["meetUrl"] ?? ""),
          sourceRef: String(e["sourceRef"] ?? ""),
        }))
      : [];
    return { reminders, events };
  };

  return {
    "calendar.syncUpsert": syncUpsert,
    "calendar.listEvents": listEvents,
    "calendar.listCalendars": listCalendars,
    "calendar.getState": getState,
    "calendar.applyLocalMutation": applyLocalMutation,
    "calendar.listOutbox": listOutbox,
    "calendar.resolveOutbox": resolveOutbox,
    "calendar.clear": clear,
    "calendar.overlay": overlay,
    "push.upcoming": pushUpcoming,
  };
}
