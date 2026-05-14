"use client";

import { useCallback, useMemo, useState } from "react";
import { AppShell, useMobileTitle, useMobileFab, useMobileHeaderActions } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Plus, ArrowsDownUp, ArrowLeft } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFinanceAccounts } from "@/components/finance/hooks";
import type { Account } from "@/components/finance/fixtures";
import { formatCurrency, formatDate } from "@/components/finance/utils";
import { trpc } from "@/lib/trpc/client";

const KIND_LABELS: Record<string, string> = {
  checking: "Courant",
  savings: "Epargne",
  livret: "Livret",
  pea: "PEA",
  cto: "CTO",
  assurance_vie: "Assurance-vie",
  crypto: "Crypto",
  other: "Autre",
};

const KIND_COLORS: Record<string, string> = {
  checking: "#60A5FA",
  savings: "#34D399",
  livret: "#A78BFA",
  pea: "#FBBF24",
  cto: "#F97316",
  assurance_vie: "#EC4899",
  crypto: "#F59E0B",
  other: "#94A3B8",
};

export default function ComptesPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { accounts, isLoading, isFallback } = useFinanceAccounts();
  const [sorting, setSorting] = useState<SortingState>([]);

  const utils = trpc.useUtils();
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "account" });
    },
  });
  const handleNewAccount = useCallback(async () => {
    try {
      await createMutation.mutateAsync({
        typeId: "account",
        fields: { name: "Nouveau compte", current_balance: 0, kind: "checking" },
      });
    } catch (err) {
      console.error("[finance/comptes] create failed", err);
    }
  }, [createMutation]);

  const columns = useMemo<ColumnDef<Account>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Nom",
        cell: ({ row }) => (
          <span className="font-medium" style={{ color: "var(--text-primary)" }}>
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "kind",
        header: "Type",
        cell: ({ row }) => (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: (KIND_COLORS[row.original.kind] ?? "#94A3B8") + "20",
              color: KIND_COLORS[row.original.kind] ?? "#94A3B8",
            }}
          >
            {KIND_LABELS[row.original.kind] ?? row.original.kind}
          </span>
        ),
      },
      {
        accessorKey: "institution",
        header: "Institution",
        cell: ({ row }) => (
          <span style={{ color: "var(--text-secondary)" }}>{row.original.institution}</span>
        ),
      },
      {
        accessorKey: "balance",
        header: "Solde",
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
            {formatCurrency(row.original.balance)}
          </span>
        ),
      },
      {
        accessorKey: "lastSyncedAt",
        header: "Derniere sync",
        cell: ({ row }) => (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {row.original.lastSyncedAt ? formatDate(row.original.lastSyncedAt) : "—"}
          </span>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: accounts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  useMobileTitle(isMobile ? "Comptes" : null);
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouveau compte", onPress: () => void handleNewAccount() }
      : null
  );
  useMobileHeaderActions([]);

  return (
    <AppShell>
    <div className="flex flex-col gap-6 px-3 py-6 md:px-6">
      <div className="hidden md:flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/finance"
            className="flex items-center gap-1 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={14} /> Finance
          </Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            Comptes
          </h1>
          {isFallback && (
            <span className="text-xs rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}>
              mode dégradé
            </span>
          )}
        </div>
        <Button
          onPress={() => void handleNewAccount()}
          isDisabled={createMutation.isPending}
          size="sm"
          className="flex items-center gap-2 font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={14} /> Compte
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
      ) : accounts.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-8 text-center"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Pas encore de données financières. Importer OFX/CSV ou ajouter un compte.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="flex flex-col gap-3 md:hidden">
            {table.getRowModel().rows.map((row) => (
              <Button
                key={row.id}
                onPress={() => router.push(`/finance/comptes/${row.original.id}`)}
                variant="ghost"
                className="w-full h-auto rounded-xl border p-4 text-left transition-colors hover:bg-[var(--surface-2)] justify-start flex-col items-start"
                style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {row.original.name}
                  </span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(row.original.balance)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: (KIND_COLORS[row.original.kind] ?? "#94A3B8") + "20",
                      color: KIND_COLORS[row.original.kind] ?? "#94A3B8",
                    }}
                  >
                    {KIND_LABELS[row.original.kind] ?? row.original.kind}
                  </span>
                  {row.original.institution && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {row.original.institution}
                    </span>
                  )}
                </div>
              </Button>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-hidden rounded-xl border" style={{ borderColor: "var(--border-subtle)" }}>
            <table className="w-full">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr
                    key={hg.id}
                    className="border-b"
                    style={{ backgroundColor: "var(--surface-2)", borderColor: "var(--border-subtle)" }}
                  >
                    {hg.headers.map((header) => (
                      <th
                        key={header.id}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex items-center gap-1 h-auto min-w-0 p-0"
                          onPress={header.column.getToggleSortingHandler() as (() => void) | undefined}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <ArrowsDownUp size={10} />
                        </Button>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row, i) => (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/finance/comptes/${row.original.id}`)}
                    className="border-b cursor-pointer transition-colors hover:bg-[var(--surface-2)]"
                    style={{
                      backgroundColor: i % 2 === 0 ? "var(--surface-1)" : "var(--surface-0)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 text-sm">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {accounts.length} compte{accounts.length > 1 ? "s" : ""} · Total :{" "}
            {formatCurrency(accounts.reduce((s, a) => s + a.balance, 0))}
          </p>
        </>
      )}
    </div>
    </AppShell>
  );
}
