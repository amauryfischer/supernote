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
  type Table,
} from "@tanstack/react-table";
import { ArrowsDownUp, CaretUp, CaretDown, X } from "@phosphor-icons/react";
import { Button, Input, Select, ListBox, ListBoxItem } from "@heroui/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FieldValue } from "@supernote/ipc";
import type { Contact, Email, Phone, RelationType } from "./fixtures";
import { ORGANISATIONS } from "./fixtures";
import { ContactAvatar } from "./ContactAvatar";
import { RelationChip, ALL_RELATION_TYPES } from "./RelationChip";
import { OrganisationSelector } from "./OrganisationSelector";
import { TagSelector } from "@/components/tags/TagSelector";
import { formatDate, isBirthdaySoon, relativeBirthday } from "./utils";

/** Signature for an inline field patch — mirrors `entities.update`'s
 *  `{ id, fields, tags? }` shape (the worker merges `fields` with existing). */
export type ContactInlineUpdate = (
  id: string,
  fields: Record<string, FieldValue>,
  opts?: { tags?: string[] },
) => void;

interface ContactsTableMeta {
  /** orgId → org name, for resolving the Organisation column without a query per row. */
  orgNames?: Map<string, string>;
  /** Persist a single-field patch. Absent ⇒ table is read-only. */
  onUpdate?: ContactInlineUpdate;
  /** Whether inline editing is enabled (live backend only). */
  canEdit?: boolean;
}

interface ContactsTableProps {
  contacts: Contact[];
  onSelectionChange?: (ids: string[]) => void;
  /** Optional map of orgId → org name for live tRPC data (overrides fixture lookup). */
  orgNames?: Map<string, string>;
  /** Persist an inline edit. When omitted (or canEdit false) cells render read-only. */
  onUpdate?: ContactInlineUpdate;
  /** Enable inline editing. Defaults to false (degraded / demo mode is read-only). */
  canEdit?: boolean;
}

const colHelper = createColumnHelper<Contact>();

function metaOf(table: Table<Contact>): ContactsTableMeta | undefined {
  return table.options.meta as ContactsTableMeta | undefined;
}

function Dash() {
  return <span className="text-[var(--text-muted)]">—</span>;
}

// ── Generic inline text editor ────────────────────────────────────────────
// Click the value → swap to a HeroUI Input. Commit on blur / Enter, cancel on
// Escape. Local draft re-syncs whenever the upstream value changes (after the
// post-save refetch), so server truth always wins once an edit settles.

interface InlineTextProps {
  value: string;
  placeholder: string;
  ariaLabel: string;
  type?: "text" | "email" | "tel" | "date";
  onCommit: (next: string) => void;
  /** Static (non-editing) rendering of the value. Defaults to plain text. */
  renderDisplay?: (value: string) => React.ReactNode;
  displayClassName?: string;
  displayStyle?: React.CSSProperties;
}

function InlineText({
  value,
  placeholder,
  ariaLabel,
  type = "text",
  onCommit,
  renderDisplay,
  displayClassName,
  displayStyle,
}: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <Input
        aria-label={ariaLabel}
        autoFocus
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const next = type === "date" ? draft : draft.trim();
          if (next !== value) onCommit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-8 min-w-[8rem] text-sm"
      />
    );
  }

  const has = value.trim().length > 0;
  return (
    <Button
      type="button"
      variant="ghost"
      onPress={() => setEditing(true)}
      aria-label={`Modifier : ${ariaLabel}`}
      className={`-mx-1 h-auto min-h-0 max-w-full justify-start truncate rounded px-1 py-0.5 text-left text-sm font-normal transition-colors hover:bg-[var(--surface-2)] ${displayClassName ?? ""}`}
      style={has ? displayStyle : { color: "var(--text-muted)" }}
    >
      {has ? (renderDisplay ? renderDisplay(value) : value) : placeholder}
    </Button>
  );
}

// ── Cell components ─────────────────────────────────────────────────────────

function NameCell({ contact, meta }: { contact: Contact; meta?: ContactsTableMeta }) {
  if (!meta?.canEdit) {
    return (
      <Link
        href={`/contacts/${contact.id}`}
        className="font-medium hover:underline"
        style={{ color: "var(--text-primary)" }}
      >
        {contact.name}
      </Link>
    );
  }
  return (
    <InlineText
      value={contact.name}
      placeholder="Sans nom"
      ariaLabel="Nom du contact"
      onCommit={(next) => meta.onUpdate?.(contact.id, { name: next })}
      displayClassName="font-medium"
      displayStyle={{ color: "var(--text-primary)" }}
    />
  );
}

function EmailCell({ contact, meta }: { contact: Contact; meta?: ContactsTableMeta }) {
  const email = contact.emails[0];
  const value = email?.value ?? "";
  if (!meta?.canEdit) {
    if (!value) return <Dash />;
    return (
      <a href={`mailto:${value}`} className="text-sm hover:underline" style={{ color: "var(--text-secondary)" }}>
        {value}
      </a>
    );
  }
  return (
    <InlineText
      value={value}
      placeholder="email@…"
      ariaLabel="Email"
      type="email"
      onCommit={(next) => {
        const list: Email[] = [...contact.emails];
        if (next) {
          if (list[0]) list[0] = { ...list[0], value: next };
          else list.unshift({ value: next, label: "perso" });
        } else if (list[0]) {
          list.shift();
        }
        meta.onUpdate?.(contact.id, { emails: JSON.stringify(list) });
      }}
      displayStyle={{ color: "var(--text-secondary)" }}
    />
  );
}

function PhoneCell({ contact, meta }: { contact: Contact; meta?: ContactsTableMeta }) {
  const phone = contact.phones[0];
  const value = phone?.value ?? "";
  if (!meta?.canEdit) {
    if (!value) return <Dash />;
    return <span className="text-sm text-[var(--text-secondary)]">{value}</span>;
  }
  return (
    <InlineText
      value={value}
      placeholder="+33 …"
      ariaLabel="Téléphone"
      type="tel"
      onCommit={(next) => {
        const list: Phone[] = [...contact.phones];
        if (next) {
          if (list[0]) list[0] = { ...list[0], value: next };
          else list.unshift({ value: next, label: "mobile" });
        } else if (list[0]) {
          list.shift();
        }
        meta.onUpdate?.(contact.id, { phones: JSON.stringify(list) });
      }}
      displayStyle={{ color: "var(--text-secondary)" }}
    />
  );
}

function OrgCell({ contact, meta }: { contact: Contact; meta?: ContactsTableMeta }) {
  const orgId = contact.organisationId;
  const name = orgId
    ? meta?.orgNames?.get(orgId) ?? ORGANISATIONS.find((o) => o.id === orgId)?.name
    : undefined;

  if (!meta?.canEdit) {
    if (!name) return <Dash />;
    return <span className="text-sm text-[var(--text-secondary)]">{name}</span>;
  }
  return (
    <OrganisationSelector
      value={orgId}
      displayName={name}
      onChange={(next) => meta.onUpdate?.(contact.id, { organisationId: next ?? "" })}
    />
  );
}

const RELATION_LABELS: Record<RelationType, string> = {
  ami: "Ami",
  famille: "Famille",
  collègue: "Collègue",
  client: "Client",
  mentor: "Mentor",
  connaissance: "Connaissance",
  partenaire: "Partenaire",
};

function RelationCell({
  contact,
  meta,
  type,
}: {
  contact: Contact;
  meta?: ContactsTableMeta;
  type: RelationType;
}) {
  if (!meta?.canEdit) return <RelationChip type={type} />;
  return (
    <Select
      selectedKey={type}
      onSelectionChange={(key) => {
        const next = String(key) as RelationType;
        if (next !== type) meta.onUpdate?.(contact.id, { relationType: next });
      }}
      aria-label="Type de relation"
    >
      <Select.Trigger
        className="flex items-center gap-1 rounded-full outline-none transition-opacity hover:opacity-80"
        aria-label={`Relation : ${RELATION_LABELS[type]}`}
      >
        <RelationChip type={type} />
        <CaretDown size={10} style={{ color: "var(--text-muted)" }} />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {ALL_RELATION_TYPES.map((rt) => (
            <ListBoxItem key={rt} textValue={RELATION_LABELS[rt]}>
              <RelationChip type={rt} />
            </ListBoxItem>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function BirthdayBadge({ birthday }: { birthday: string | undefined }) {
  const soon = isBirthdaySoon(birthday);
  const rel = relativeBirthday(birthday);
  if (!rel) return <Dash />;
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

function BirthdayCell({
  contact,
  meta,
  birthday,
}: {
  contact: Contact;
  meta?: ContactsTableMeta;
  birthday: string | undefined;
}) {
  if (!meta?.canEdit) return <BirthdayBadge birthday={birthday} />;
  return (
    <InlineText
      value={birthday ?? ""}
      placeholder="+ date"
      ariaLabel="Anniversaire"
      type="date"
      onCommit={(next) => meta.onUpdate?.(contact.id, { birthday: next })}
      renderDisplay={() => <BirthdayBadge birthday={birthday} />}
    />
  );
}

function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
      style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
    >
      {tag}
      {onRemove && (
        <Button
          type="button"
          isIconOnly
          variant="ghost"
          size="sm"
          onPress={onRemove}
          className="h-auto min-h-0 min-w-0 p-0 transition-opacity hover:opacity-70"
          aria-label={`Retirer ${tag}`}
        >
          <X size={9} />
        </Button>
      )}
    </span>
  );
}

function TagsCell({ contact, meta }: { contact: Contact; meta?: ContactsTableMeta }) {
  const tags = contact.tags;
  if (!meta?.canEdit) {
    return (
      <div className="flex flex-wrap gap-1">
        {tags.slice(0, 3).map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
        {tags.length > 3 && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            +{tags.length - 3}
          </span>
        )}
      </div>
    );
  }
  const commit = (next: string[]) =>
    meta.onUpdate?.(contact.id, { tags: JSON.stringify(next) }, { tags: next });
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} onRemove={() => commit(tags.filter((t) => t !== tag))} />
      ))}
      <TagSelector value={tags} onChange={commit} />
    </div>
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
      // Avatar is the row's link to the detail page — the name cell is now an
      // inline editor, so navigation lives here.
      <Link
        href={`/contacts/${row.original.id}`}
        className="inline-flex rounded-full transition-opacity hover:opacity-80"
        aria-label={`Ouvrir la fiche de ${row.original.name}`}
      >
        <ContactAvatar name={row.original.name} photoUrl={row.original.photoUrl} size={32} />
      </Link>
    ),
    size: 44,
  }),
  colHelper.accessor("name", {
    header: "Nom",
    cell: ({ row, table }) => <NameCell contact={row.original} meta={metaOf(table)} />,
  }),
  colHelper.display({
    id: "email",
    header: "Email",
    cell: ({ row, table }) => <EmailCell contact={row.original} meta={metaOf(table)} />,
  }),
  colHelper.display({
    id: "phone",
    header: "Téléphone",
    cell: ({ row, table }) => <PhoneCell contact={row.original} meta={metaOf(table)} />,
  }),
  colHelper.display({
    id: "organisation",
    header: "Organisation",
    cell: ({ row, table }) => <OrgCell contact={row.original} meta={metaOf(table)} />,
  }),
  colHelper.accessor("relationType", {
    header: "Relation",
    cell: ({ getValue, row, table }) => (
      <RelationCell contact={row.original} meta={metaOf(table)} type={getValue()} />
    ),
  }),
  colHelper.accessor("birthday", {
    header: "Anniversaire",
    cell: ({ getValue, row, table }) => (
      <BirthdayCell contact={row.original} meta={metaOf(table)} birthday={getValue()} />
    ),
  }),
  colHelper.display({
    id: "tags",
    header: "Tags",
    cell: ({ row, table }) => <TagsCell contact={row.original} meta={metaOf(table)} />,
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

export function ContactsTable({
  contacts,
  onSelectionChange,
  orgNames,
  onUpdate,
  canEdit,
}: ContactsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const table = useReactTable({
    data: contacts,
    columns: COLUMNS,
    state: { sorting, rowSelection },
    meta: { orgNames, onUpdate, canEdit: canEdit && !!onUpdate },
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
