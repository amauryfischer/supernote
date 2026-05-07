import React, { useCallback, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Entity } from "@supernote/core/types";
import type { ViewProps } from "../../types/index.js";
import { queryEntities } from "../../query/index.js";
import { formatFieldValue } from "../../utils/field.js";

const VIRTUALIZE_THRESHOLD = 100;

export function TableView<T extends Entity = Entity>({
  view,
  entities,
  schema,
  onEntityClick,
  onEntityChange,
  onEntityCreate,
}: ViewProps<T>): React.JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const processed = useMemo(
    () => queryEntities(entities, view.filters ?? [], view.sort ?? []),
    [entities, view.filters, view.sort]
  );

  const visibleFields = useMemo(() => {
    if (view.columns && view.columns.length > 0) {
      return schema.fields.filter((f) =>
        view.columns!.some((c) => c.fieldId === f.id && !c.hidden)
      );
    }
    return schema.fields.slice(0, 10);
  }, [schema.fields, view.columns]);

  const columns = useMemo<ColumnDef<T>[]>(() => {
    const fieldCols: ColumnDef<T>[] = visibleFields.map((field) => ({
      id: field.id,
      accessorFn: (row: T) => row.fields[field.id],
      header: field.label,
      cell: ({ getValue }) => {
        const val = getValue();
        return (
          <span className="table-cell-value">
            {formatFieldValue(val as Parameters<typeof formatFieldValue>[0])}
          </span>
        );
      },
    }));
    return fieldCols;
  }, [visibleFields]);

  const table = useReactTable({
    data: processed,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  const rows = table.getRowModel().rows;
  const shouldVirtualize = rows.length > VIRTUALIZE_THRESHOLD;

  const parentRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    enabled: shouldVirtualize,
  });

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="table-view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        ref={parentRef}
        style={{ overflow: "auto", flex: 1 }}
        data-testid="table-view"
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                <th style={{ width: 32 }}>
                  <input type="checkbox" aria-label="Select all" onChange={() => {}} />
                </th>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ cursor: header.column.getCanSort() ? "pointer" : "default", textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #e2e8f0" }}
                    onClick={header.column.getToggleSortingHandler()}
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                        ? "descending"
                        : "none"
                    }
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === "asc" && " ↑"}
                    {header.column.getIsSorted() === "desc" && " ↓"}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody
            style={
              shouldVirtualize
                ? { height: `${virtualizer.getTotalSize()}px`, position: "relative" }
                : {}
            }
          >
            {shouldVirtualize
              ? virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  if (!row) return null;
                  return (
                    <TableRow
                      key={row.id}
                      row={row}
                      selected={selected.has(row.id)}
                      onToggle={toggleSelect}
                      onClick={onEntityClick}
                      style={{
                        position: "absolute",
                        top: `${virtualRow.start}px`,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                      }}
                    />
                  );
                })
              : rows.map((row) => (
                  <TableRow
                    key={row.id}
                    row={row}
                    selected={selected.has(row.id)}
                    onToggle={toggleSelect}
                    onClick={onEntityClick}
                  />
                ))}
          </tbody>
        </table>
      </div>
      {onEntityCreate && (
        <button
          style={{ margin: 8, alignSelf: "flex-start" }}
          onClick={() => onEntityCreate()}
          aria-label="Add row"
        >
          + Add row
        </button>
      )}
      {onEntityChange && selected.size > 0 && (
        <div style={{ padding: 8, fontSize: 12, color: "#64748b" }}>
          {selected.size} row(s) selected
        </div>
      )}
    </div>
  );
}

interface TableRowProps<T extends Entity> {
  row: import("@tanstack/react-table").Row<T>;
  selected: boolean;
  onToggle: (id: string) => void;
  onClick?: (entity: T) => void;
  style?: React.CSSProperties;
}

function TableRow<T extends Entity>({
  row,
  selected,
  onToggle,
  onClick,
  style,
}: TableRowProps<T>): React.JSX.Element {
  return (
    <tr
      style={{ background: selected ? "#eff6ff" : undefined, cursor: "pointer", ...style }}
      onClick={() => onClick?.(row.original)}
      data-testid="table-row"
    >
      <td style={{ width: 32 }}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${row.id}`}
          onChange={(e) => {
            e.stopPropagation();
            onToggle(row.id);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} style={{ padding: "8px 12px", borderBottom: "1px solid #f1f5f9" }}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}
