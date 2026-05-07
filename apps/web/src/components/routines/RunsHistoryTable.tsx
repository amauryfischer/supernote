"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { RunRecord } from "./fixtures";
import { formatRunDate } from "./fixtures";
import { RunStatusPill } from "./RunStatusPill";

const colHelper = createColumnHelper<RunRecord>();

const COLUMNS = [
  colHelper.accessor("status", {
    header: "Statut",
    cell: ({ getValue }) => <RunStatusPill status={getValue()} />,
  }),
  colHelper.accessor("startedAt", {
    header: "Démarré le",
    cell: ({ getValue }) => (
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {formatRunDate(getValue())}
      </span>
    ),
  }),
  colHelper.accessor("durationMs", {
    header: "Durée",
    cell: ({ getValue }) => (
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {getValue() >= 1000 ? `${(getValue() / 1000).toFixed(1)}s` : `${getValue()}ms`}
      </span>
    ),
  }),
  colHelper.accessor("error", {
    header: "Erreur",
    cell: ({ getValue }) => {
      const err = getValue();
      if (!err) return <span style={{ color: "var(--text-muted)" }}>—</span>;
      return (
        <span className="text-xs" style={{ color: "var(--danger)" }}>
          {err}
        </span>
      );
    },
  }),
];

interface RunsHistoryTableProps {
  runs: RunRecord[];
}

export function RunsHistoryTable({ runs }: RunsHistoryTableProps) {
  const table = useReactTable({
    data: runs,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
  });

  if (runs.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        Aucun run pour cette routine.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-3 py-2 text-left text-xs font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="transition-colors hover:bg-[var(--surface-1)]"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
