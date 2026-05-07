"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { ArrowsDownUp, CaretUp, CaretDown } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import type { Contact } from "./fixtures";
import { ORGANISATIONS } from "./fixtures";
import { ContactAvatar } from "./ContactAvatar";
import { RelationChip } from "./RelationChip";
import { formatDate, isBirthdaySoon, relativeBirthday } from "./utils";

interface ContactsTableProps {
  contacts: Contact[];
  onSelectionChange?: (ids: string[]) => void;
}

const colHelper = createColumnHelper<Contact>();

function OrgLink({ orgId }: { orgId: string | undefined }) {
  const org = ORGANISATIONS.find((o) => o.id === orgId);
  if (!org) return <span className="text-[var(--text-muted)]">—</span>;
  return <span className="text-sm text-[var(--text-secondary)]">{org.name}</span>;
}

function BirthdayCell({ birthday }: { birthday: string | undefined }) {
  const soon = isBirthdaySoon(birthday);
  const rel = relativeBirthday(birthday);
  if (!rel) return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <span
      className="text-xs"
      style={
        soon
          ? { color: "oklch(0.55 0.20 28)", fontWeight: 600, background: "oklch(0.96 0.05 28)", padding: "2px 6px", borderRadius: 4 }
          : { color: "var(--text-muted)" }
      }
    >
      {rel}
    </span>
  );
}

const COLUMNS = [
  colHelper.display({
    id: "select",
    header: ({ table }) => (
      <input
        type="checkbox"
        checked={table.getIsAllRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
        className="cursor-pointer accent-[var(--accent)]"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        className="cursor-pointer accent-[var(--accent)]"
      />
    ),
    size: 36,
  }),
  colHelper.display({
    id: "avatar",
    header: "",
    cell: ({ row }) => (
      <ContactAvatar name={row.original.name} photoUrl={row.original.photoUrl} size={32} />
    ),
    size: 44,
  }),
  colHelper.accessor("name", {
    header: "Nom",
    cell: ({ getValue, row }) => (
      <Link
        href={`/contacts/${row.original.id}`}
        className="font-medium hover:underline"
        style={{ color: "var(--text-primary)" }}
      >
        {getValue()}
      </Link>
    ),
  }),
  colHelper.display({
    id: "email",
    header: "Email",
    cell: ({ row }) => {
      const email = row.original.emails[0];
      if (!email) return <span className="text-[var(--text-muted)]">—</span>;
      return (
        <a href={`mailto:${email.value}`} className="text-sm hover:underline" style={{ color: "var(--text-secondary)" }}>
          {email.value}
        </a>
      );
    },
  }),
  colHelper.display({
    id: "phone",
    header: "Téléphone",
    cell: ({ row }) => {
      const phone = row.original.phones[0];
      if (!phone) return <span className="text-[var(--text-muted)]">—</span>;
      return <span className="text-sm text-[var(--text-secondary)]">{phone.value}</span>;
    },
  }),
  colHelper.display({
    id: "organisation",
    header: "Organisation",
    cell: ({ row }) => <OrgLink orgId={row.original.organisationId} />,
  }),
  colHelper.accessor("relationType", {
    header: "Relation",
    cell: ({ getValue }) => <RelationChip type={getValue()} />,
  }),
  colHelper.accessor("birthday", {
    header: "Anniversaire",
    cell: ({ getValue }) => <BirthdayCell birthday={getValue()} />,
  }),
  colHelper.display({
    id: "tags",
    header: "Tags",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded px-1.5 py-0.5 text-xs"
            style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
          >
            {tag}
          </span>
        ))}
        {row.original.tags.length > 3 && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            +{row.original.tags.length - 3}
          </span>
        )}
      </div>
    ),
  }),
  colHelper.accessor("lastInteractionDate", {
    header: "Dernière interaction",
    cell: ({ getValue }) => {
      const v = getValue();
      return (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {v ? formatDate(v) : "—"}
        </span>
      );
    },
  }),
];

export function ContactsTable({ contacts, onSelectionChange }: ContactsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const table = useReactTable({
    data: contacts,
    columns: COLUMNS,
    state: { sorting, rowSelection },
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      setRowSelection(next);
      const selectedIds = Object.keys(next).filter((k) => next[k]);
      onSelectionChange?.(selectedIds);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableRowSelection: true,
  });

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
                  style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}
                >
                  {header.isPlaceholder ? null : (
                    <div
                      className={header.column.getCanSort() ? "flex cursor-pointer items-center gap-1 select-none" : ""}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span className="opacity-40">
                          {header.column.getIsSorted() === "asc" ? (
                            <CaretUp size={12} />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <CaretDown size={12} />
                          ) : (
                            <ArrowsDownUp size={12} />
                          )}
                        </span>
                      )}
                    </div>
                  )}
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
              style={{
                borderBottom: "1px solid var(--border-subtle)",
                backgroundColor: row.getIsSelected() ? "var(--accent-subtle)" : undefined,
              }}
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
      {contacts.length === 0 && (
        <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Aucun contact trouvé.
        </div>
      )}
    </div>
  );
}
