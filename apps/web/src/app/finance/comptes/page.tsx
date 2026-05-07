"use client";

import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Plus, ArrowUpDown, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ACCOUNTS, type Account } from "@/components/finance/fixtures";
import { formatCurrency, formatDate } from "@/components/finance/utils";

const KIND_LABELS: Record<string, string> = {
  checking: "Courant",
  savings: "Épargne",
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
  const [sorting, setSorting] = useState<SortingState>([]);

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
        header: "Dernière sync",
        cell: ({ row }) => (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {formatDate(row.original.lastSyncedAt)}
          </span>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: ACCOUNTS,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
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
        </div>
        <button
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={14} /> Compte
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border-subtle)" }}>
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
                    <button
                      className="flex items-center gap-1"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <ArrowUpDown size={10} />
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <tr
                key={row.id}
                className="border-b transition-colors hover:bg-[var(--surface-2)]"
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
        {ACCOUNTS.length} compte{ACCOUNTS.length > 1 ? "s" : ""} · Total :{" "}
        {formatCurrency(ACCOUNTS.reduce((s, a) => s + a.balance, 0))}
      </p>
    </div>
  );
}
