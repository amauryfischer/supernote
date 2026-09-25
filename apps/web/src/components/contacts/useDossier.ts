import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/components/settings/SettingsContext";
import { useMailCommitments } from "@/components/mail/useMailCommitments";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import { calendarAccount } from "@/lib/calendar-sync";
import { mirrorAvailable, mirrorSearchThreads } from "@/lib/mail-mirror";
import type { ThreadListItem } from "@/lib/gmail";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import {
  buildDossier,
  dossierScope,
  matchesScope,
  type DossierItem,
  type DossierScope,
  type DossierSection,
  type EntityRef,
} from "@/lib/dossier";

const DAY_MS = 86_400_000;
const MAX_ADDRESSES = 8;
const MAX_MENTION_SOURCES = 10;
const MAX_NOTES = 20;

const time = (v: unknown): number => (typeof v === "string" ? Date.parse(v) || 0 : typeof v === "number" ? v : 0);
const dayAt9 = (day: string): number => new Date(`${day}T09:00:00`).getTime();

interface Collected {
  items: DossierItem[];
  threadIds: string[];
  threadAt: Record<string, number>;
}

async function collect(scope: DossierScope, mailAccount: string, calAccount: string): Promise<Collected> {
  const items: DossierItem[] = [];
  const threadIds = new Set<string>();

  if (mailAccount && mirrorAvailable()) {
    const addresses = scope.emails.slice(0, MAX_ADDRESSES);
    const fromSearches = [
      ...addresses.map((e) => mirrorSearchThreads(mailAccount, { from: [e], limit: 20 })),
      ...(scope.domain ? [mirrorSearchThreads(mailAccount, { from: [`@${scope.domain}`], limit: 30 })] : []),
    ];
    // `from` ne voit que l'expéditeur du DERNIER message : un fil où j'ai répondu en dernier ne sort que par `to`.
    const toSearches = addresses.map((e) => mirrorSearchThreads(mailAccount, { to: [e], limit: 10 }));
    const [fromLists, toLists] = await Promise.all([
      Promise.all(fromSearches.map((p) => p.catch(() => []))),
      Promise.all(toSearches.map((p) => p.catch(() => []))),
    ]);
    const push = (t: ThreadListItem) => {
      threadIds.add(t.id);
      items.push({
        key: `mail:${t.id}`,
        kind: "mail",
        at: time(t.date),
        title: t.subject || "(sans objet)",
        meta: t.from.name || t.from.email,
        url: `/mail?thread=${encodeURIComponent(t.id)}`,
      });
    };
    // La recherche du miroir est un LIKE sur l'adresse ET le nom : on revérifie l'expéditeur exact.
    for (const t of fromLists.flat()) if (matchesScope(scope, t.from.email)) push(t);
    for (const t of toLists.flat()) push(t);
  }

  const backlinks = await Promise.all(
    scope.entityIds.slice(0, MAX_MENTION_SOURCES).map((id) => trpcVanillaClient.entities.getBacklinks.query({ id }).catch(() => [])),
  );
  const noteIds = [...new Set(backlinks.flat().filter((b) => b.sourceTypeId === "note").map((b) => b.sourceId))].slice(0, MAX_NOTES);
  const titles = new Map(backlinks.flat().map((b) => [b.sourceId, b.sourceTitle]));
  const notes = await Promise.all(noteIds.map((id) => trpcVanillaClient.entities.get.query({ id }).catch(() => null)));
  for (const n of notes) {
    if (!n) continue;
    items.push({
      key: `note:${n.id}`,
      kind: "note",
      at: time(n.updatedAt),
      title: titles.get(n.id) || n.filePath.split("/").pop() || "Sans titre",
      meta: "Note",
      url: `/notes/${n.id}`,
    });
  }

  if (calAccount) {
    const now = Date.now();
    const res = await trpcVanillaClient.calendar.listEvents
      .query({ accountId: calAccount, from: now - 180 * DAY_MS, to: now + 60 * DAY_MS })
      .catch(() => ({ events: [] }));
    for (const e of res.events) {
      if (!e.attendees.some((a) => !a.self && matchesScope(scope, a.email))) continue;
      items.push({
        key: `event:${e.id}`,
        kind: "event",
        at: e.startAt,
        title: e.summary || "(sans titre)",
        meta: e.attendees.filter((a) => !a.self).map((a) => a.name || a.email).slice(0, 3).join(", "),
        url: `/agenda?event=${encodeURIComponent(e.id)}&at=${e.startAt}`,
        upcoming: true,
      });
    }
  }

  const interactions = await trpcVanillaClient.entities.list
    .query({ typeId: "interaction", limit: 500 })
    .catch(() => ({ items: [] }));
  for (const e of interactions.items) {
    const f = e.fields as Record<string, unknown>;
    if (!scope.entityIds.includes(String(f["participants"] ?? "")) && !scope.entityIds.includes(String(f["contactId"] ?? ""))) continue;
    const title = f["title"] ?? f["name"] ?? f["subject"];
    items.push({
      key: `interaction:${e.id}`,
      kind: "interaction",
      at: time(f["date"]) || time(e.updatedAt),
      title: typeof title === "string" ? title : "Interaction",
      meta: typeof f["kind"] === "string" ? f["kind"] : "",
      url: null,
    });
  }

  return { items, threadIds: [...threadIds], threadAt: Object.fromEntries(items.filter((i) => i.kind === "mail").map((i) => [i.key.slice(5), i.at])) };
}

/** Fil chronologique d'une personne ou d'une organisation, calculé depuis le coffre local. */
export function useDossier(entity: EntityRef | null): { sections: DossierSection[]; loading: boolean } {
  const { settings } = useSettings();
  const mailAccount = settings.gmail.connectedEmail;
  const calAccount = calendarAccount(settings)?.accountId ?? "";
  const isOrg = entity?.typeId === "organisation";

  const personnes = trpc.entities.listSummaries.useQuery(
    { typeId: "personne", limit: 2000, offset: 0 },
    { enabled: isOrg, staleTime: 60_000 },
  );
  const scope = useMemo(() => {
    if (!entity) return null;
    const people = (personnes.data?.items ?? []).map((p) => ({ id: p.id, typeId: "personne", fields: (p.fields ?? {}) as Record<string, unknown> }));
    return dossierScope(entity, people);
  }, [entity, personnes.data]);

  const collected = useQuery({
    queryKey: ["dossier", entity?.id, scope?.entityIds.join(","), scope?.emails.join(","), scope?.domain, mailAccount, calAccount],
    enabled: !!scope && (!isOrg || !!personnes.data),
    staleTime: 60_000,
    queryFn: () => collect(scope!, mailAccount, calAccount),
  });

  const { all } = useMailCommitments();
  const todos = trpc.entities.list.useQuery({ typeId: TODO_TYPE_ID, limit: 2000 }, { enabled: !!scope, staleTime: 60_000 });

  const sections = useMemo(() => {
    if (!scope) return [];
    const now = Date.now();
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const items = [...(collected.data?.items ?? [])];
    const threads = new Set(collected.data?.threadIds ?? []);

    for (const tc of all) {
      if (tc.accountId !== mailAccount) continue;
      for (const c of tc.items) {
        if (c.status === "dismissed" || !matchesScope(scope, c.whoEmail)) continue;
        threads.add(tc.threadId);
        // Sans échéance : la date du fil, sinon « Sans date » (jamais une fausse date du jour).
        const at = c.due ? dayAt9(c.due) : collected.data?.threadAt[tc.threadId] ?? 0;
        items.push({
          key: `commitment:${tc.threadId}:${c.key}`,
          kind: "commitment",
          at,
          title: c.text,
          meta: `${c.direction === "moi" ? "Je dois" : "On me doit"}${c.status === "suggested" ? " · à valider" : ""}`,
          url: `/mail?thread=${encodeURIComponent(tc.threadId)}`,
          upcoming: !!c.due && at >= now,
        });
      }
    }

    for (const t of todos.data?.items ?? []) {
      const f = t.fields as Record<string, unknown>;
      const thread = f["mailThreadId"];
      if (typeof thread !== "string" || !threads.has(thread)) continue;
      const due = typeof f["dueDate"] === "string" && f["dueDate"] ? dayAt9(f["dueDate"]) : 0;
      const done = f["done"] === true || f["done"] === "true";
      items.push({
        key: `todo:${t.id}`,
        kind: "todo",
        at: due || time(t.updatedAt),
        title: typeof f["text"] === "string" ? f["text"] : "Tâche",
        meta: done ? "Tâche faite" : "Tâche à faire",
        url: "/todos",
        upcoming: !done && due >= startOfToday,
      });
    }
    return buildDossier(items, now);
  }, [scope, collected.data, all, mailAccount, todos.data]);

  return { sections, loading: collected.isPending || (isOrg && personnes.isLoading) };
}
