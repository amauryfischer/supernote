"use client";

import { Card, Skeleton } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";

interface StatTileProps {
  count: number | undefined;
  label: string;
  href: string;
  loading: boolean;
}

function StatTile({ count, label, href, loading }: StatTileProps) {
  const router = useRouter();
  return (
    <Card
      className="border shadow-none p-3 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
      onClick={() => router.push(href)}
    >
      {loading ? (
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-10 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[28px] font-semibold leading-tight tabular-nums"
            style={{ color: "var(--text-primary)" }}
          >
            {count ?? 0}
          </span>
          <span
            className="text-[11px] uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {label}
          </span>
        </div>
      )}
    </Card>
  );
}

export function VaultStatsWidget() {
  const t = useTranslations("home.widgets.stats");

  const notesQuery = trpc.entities.list.useQuery(
    { typeId: "note", limit: 10000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );
  const todosQuery = trpc.entities.list.useQuery(
    { typeId: TODO_TYPE_ID, limit: 10000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );
  const contactsQuery = trpc.entities.list.useQuery(
    { typeId: "contact", limit: 10000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );
  const schemasQuery = trpc.entities.list.useQuery(
    { typeId: "schema", limit: 10000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );

  const isLoading =
    notesQuery.isLoading ||
    todosQuery.isLoading ||
    contactsQuery.isLoading ||
    schemasQuery.isLoading;

  const notesCount = notesQuery.data?.items.length;
  const openTodosCount = todosQuery.data?.items.filter(
    (t) => !(t.fields["done"] === true || t.fields["done"] === "true"),
  ).length;
  const contactsCount = contactsQuery.data?.items.length;
  const schemasCount = schemasQuery.data?.items.length;

  return (
    <Card className="border shadow-none p-4 flex flex-col gap-3">
      <span
        className="text-[12px] font-bold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {t("title")}
      </span>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile count={notesCount} label={t("notes")} href="/notes" loading={isLoading} />
        <StatTile count={openTodosCount} label={t("todos")} href="/todos" loading={isLoading} />
        <StatTile count={contactsCount} label={t("contacts")} href="/contacts" loading={isLoading} />
        <StatTile count={schemasCount} label={t("schemas")} href="/schemas" loading={isLoading} />
      </div>
    </Card>
  );
}
