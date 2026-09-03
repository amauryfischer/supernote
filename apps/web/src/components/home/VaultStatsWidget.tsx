"use client";

import Link from "next/link";
import { Skeleton } from "@supernote/ui";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { SectionNotice } from "./HomeSection";

/**
 * Bande de compteurs du coffre. Aplatie en une ligne de liens : quatre tuiles
 * bordées à chiffre de 28px dans une carte bordée faisaient deux niveaux de
 * boîte pour quatre entiers.
 */
export function VaultStatsWidget() {
  const t = useTranslations("home.widgets.stats");
  const tCommon = useTranslations("home");

  // Compteurs purs (COUNT SQL) — plus de rapatriement de 10 000 entités + bodies
  // juste pour un `.length`.
  const notesQuery = trpc.entities.count.useQuery(
    { typeId: "note" },
    { staleTime: 60_000, retry: false },
  );
  const contactsQuery = trpc.entities.count.useQuery(
    { typeId: "contact" },
    { staleTime: 60_000, retry: false },
  );
  const schemasQuery = trpc.entities.count.useQuery(
    { typeId: "schema" },
    { staleTime: 60_000, retry: false },
  );
  // Les todos ouverts exigent un filtre sur le champ `done` (JSON) → on tire les
  // résumés (sans body) et on filtre côté client.
  const todosQuery = trpc.entities.listSummaries.useQuery(
    { typeId: TODO_TYPE_ID, limit: 10000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );

  const isLoading =
    notesQuery.isLoading ||
    todosQuery.isLoading ||
    contactsQuery.isLoading ||
    schemasQuery.isLoading;

  const hasError =
    notesQuery.isError &&
    todosQuery.isError &&
    contactsQuery.isError &&
    schemasQuery.isError;

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-x-6 gap-y-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-24" />
        ))}
      </div>
    );
  }

  if (hasError) {
    return (
      <SectionNotice
        tone="danger"
        action={{
          label: tCommon("retry"),
          onClick: () => {
            void notesQuery.refetch();
            void todosQuery.refetch();
            void contactsQuery.refetch();
            void schemasQuery.refetch();
          },
        }}
      >
        {t("error")}
      </SectionNotice>
    );
  }

  const openTodosCount = todosQuery.data?.items.filter(
    (e) => !(e.fields["done"] === true || e.fields["done"] === "true"),
  ).length;

  const stats: { key: string; count: number | undefined; label: string; href: string }[] = [
    { key: "notes", count: notesQuery.data?.count, label: t("notes"), href: "/notes" },
    { key: "todos", count: openTodosCount, label: t("todos"), href: "/todos" },
    { key: "contacts", count: contactsQuery.data?.count, label: t("contacts"), href: "/contacts" },
    { key: "schemas", count: schemasQuery.data?.count, label: t("schemas"), href: "/schemas" },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-4 md:flex md:flex-wrap md:gap-x-7">
      {stats.map(({ key, count, label, href }) => (
        <Link
          key={key}
          href={href}
          prefetch={false}
          className="-mx-1.5 flex min-h-[40px] items-center gap-1.5 rounded-[var(--radius-md)] px-1.5 transition-colors hover:bg-[var(--surface-2)] md:min-h-[28px]"
        >
          <span
            className="text-[15px] font-semibold tabular-nums"
            style={{ color: "var(--text-primary)" }}
          >
            {count ?? 0}
          </span>
          <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {label}
          </span>
        </Link>
      ))}
    </div>
  );
}
