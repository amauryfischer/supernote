"use client";

/**
 * OrganisationSelector — anchored popover that lets the user PICK or CREATE
 * a real `organisation` entity (not a fixture row, not free text). The
 * selected entity's ULID is what gets stored as `fields.organisationId`
 * on the contact, mirroring the TagSelector flow used elsewhere on the
 * contact form.
 *
 * Behaviour:
 *   - Trigger button shows the resolved organisation name + chevron.
 *     Empty state shows "Choisir une organisation".
 *   - Click opens an anchored popover with a search input.
 *   - Search hits `entities.search({ query, typeId: "organisation" })`.
 *     With an empty query we instead list all organisations via
 *     `entities.list({ typeId: "organisation" })` so the user always sees
 *     options on first open.
 *   - Each row is clickable → selects that org's ULID.
 *   - Footer "Créer l'organisation '{query}'" appears when the typed
 *     query has no exact name match. It calls
 *     `entities.create({ typeId: "organisation", fields: { name: query } })`
 *     then selects the new entity.
 *   - Click-outside / Escape closes (same pattern as TagSelector).
 *
 * Resolution of an existing `organisationId`:
 *   The trigger fetches the entity via `entities.get` to display its name.
 *   If the id no longer resolves (legacy fixture id like `org-1`, deleted
 *   entity, etc) we render "(organisation introuvable)" so the user can
 *   pick a replacement instead of seeing a broken placeholder.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Buildings,
  CaretDown,
  Check,
  MagnifyingGlass,
  Plus,
  X,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";
import type { EntitySummary } from "@supernote/ipc";

interface OrganisationSelectorProps {
  /** Currently selected organisation entity id (ULID). */
  value: string | undefined;
  /** Called with the new id (or undefined when cleared). */
  onChange: (next: string | undefined) => void;
  /** Optional override for the empty-state trigger label. */
  placeholder?: string;
}

/** Read the canonical display name from an organisation entity's fields. */
function orgName(entity: { fields: Record<string, unknown> }): string {
  const raw = entity.fields["name"];
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return "Sans nom";
}

export function OrganisationSelector({
  value,
  onChange,
  placeholder,
}: OrganisationSelectorProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Resolve the currently-selected entity to display its name in the
  // trigger. When the id no longer exists (legacy fixture id, deleted
  // entity) we fall back to a clear "introuvable" label so the user
  // understands why the picker shows nothing useful.
  const selectedQuery = trpc.entities.get.useQuery(
    { id: value ?? "" },
    { enabled: !!value, retry: false },
  );

  const selectedLabel = useMemo(() => {
    if (!value) return placeholder ?? "Choisir une organisation";
    if (selectedQuery.isPending) return "…";
    if (selectedQuery.isError || !selectedQuery.data) return "(organisation introuvable)";
    return orgName(selectedQuery.data);
  }, [value, selectedQuery.isPending, selectedQuery.isError, selectedQuery.data, placeholder]);

  const isMissing =
    !!value && !selectedQuery.isPending && (selectedQuery.isError || !selectedQuery.data);

  const handleOpen = () => {
    if (triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen(true);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[var(--accent)] hover:bg-[var(--surface-2)]"
        style={{
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--surface-1)",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Buildings size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span
          className="flex-1 truncate text-left"
          style={{
            color: isMissing
              ? "var(--danger)"
              : value
                ? "var(--text-primary)"
                : "var(--text-muted)",
          }}
        >
          {selectedLabel}
        </span>
        {value && (
          <button
            type="button"
            onClick={clear}
            className="flex h-4 w-4 items-center justify-center rounded hover:bg-[var(--surface-3)]"
            aria-label="Retirer l'organisation"
            tabIndex={-1}
          >
            <X size={11} style={{ color: "var(--text-muted)" }} />
          </button>
        )}
        <CaretDown size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      </button>
      <OrganisationSelectorPopover
        open={open}
        anchorRect={anchorRect}
        value={value}
        onChange={(next) => {
          onChange(next);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

interface PopoverProps {
  open: boolean;
  anchorRect: DOMRect | null;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  onClose: () => void;
}

function OrganisationSelectorPopover({
  open,
  anchorRect,
  value,
  onChange,
  onClose,
}: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const utils = trpc.useUtils();

  // With an empty query we want to show ALL existing organisations
  // (typical "open the picker, see what's there" flow). The search
  // procedure rejects an empty string (`min(1)`), so we use `list`
  // for the no-query case and `search` once the user types.
  const trimmed = query.trim();
  const listQuery = trpc.entities.list.useQuery(
    { typeId: "organisation", limit: 200 },
    { enabled: open && trimmed.length === 0 },
  );
  const searchQuery = trpc.entities.search.useQuery(
    { query: trimmed, typeId: "organisation", limit: 50 },
    { enabled: open && trimmed.length > 0 },
  );

  const createMut = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "organisation" });
      void utils.entities.search.invalidate();
    },
  });

  // Click-outside + Escape close — same pattern as TagSelector.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Reset the search field every time the popover opens.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const items: EntitySummary[] = useMemo(() => {
    if (trimmed.length === 0) {
      return (listQuery.data?.items as EntitySummary[] | undefined) ?? [];
    }
    return (searchQuery.data?.items as EntitySummary[] | undefined) ?? [];
  }, [trimmed, listQuery.data, searchQuery.data]);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => orgName(a).localeCompare(orgName(b)));
  }, [items]);

  const exactMatch = useMemo(
    () => items.some((e) => orgName(e).toLowerCase() === trimmed.toLowerCase()),
    [items, trimmed],
  );

  const isLoading = trimmed.length === 0 ? listQuery.isPending : searchQuery.isPending;

  const handleCreate = async () => {
    if (!trimmed) return;
    try {
      const created = await createMut.mutateAsync({
        typeId: "organisation",
        fields: { name: trimmed },
      });
      onChange(created.id);
      setQuery("");
    } catch {
      // Silent — user can retry. Don't disrupt the popover with toasts.
    }
  };

  if (!open || !anchorRect) return null;

  // Naive flip — same as TagSelector.
  const POP_W = Math.max(280, anchorRect.width);
  const POP_H = 320;
  const margin = 6;
  let left = anchorRect.left;
  let top = anchorRect.bottom + margin;
  if (left + POP_W > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - POP_W - 8);
  }
  if (top + POP_H > window.innerHeight - 8) {
    top = Math.max(8, anchorRect.top - POP_H - margin);
  }

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Choisir une organisation"
      className="fixed z-50 flex flex-col rounded-lg shadow-xl"
      style={{
        left,
        top,
        width: POP_W,
        maxHeight: POP_H,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-1.5 border-b px-2 py-1.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <MagnifyingGlass size={12} style={{ color: "var(--text-muted)" }} />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une organisation…"
          className="flex-1 bg-transparent text-xs outline-none"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && (
          <p className="px-3 py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Chargement…
          </p>
        )}
        {!isLoading && sorted.length === 0 && (
          <p className="px-3 py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {trimmed
              ? "Aucun résultat."
              : "Aucune organisation. Tape un nom pour en créer une."}
          </p>
        )}
        {sorted.map((entity) => {
          const selected = entity.id === value;
          const sector =
            typeof entity.fields["sector"] === "string"
              ? (entity.fields["sector"] as string)
              : "";
          const orgType =
            typeof entity.fields["type"] === "string"
              ? (entity.fields["type"] as string)
              : "";
          const subtitle = sector || orgType;
          return (
            <button
              key={entity.id}
              type="button"
              onClick={() => onChange(entity.id)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-2)]"
            >
              <Buildings
                size={12}
                style={{ color: "var(--text-muted)", flexShrink: 0 }}
              />
              <span className="flex flex-1 flex-col overflow-hidden">
                <span
                  className="truncate"
                  style={{
                    color: selected ? "var(--accent)" : "var(--text-primary)",
                  }}
                >
                  {orgName(entity)}
                </span>
                {subtitle && (
                  <span
                    className="truncate text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {subtitle}
                  </span>
                )}
              </span>
              {selected && <Check size={11} style={{ color: "var(--accent)" }} />}
            </button>
          );
        })}
      </div>

      {trimmed && !exactMatch && (
        <button
          type="button"
          onClick={handleCreate}
          disabled={createMut.isPending}
          className="flex items-center gap-1.5 border-t px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
          style={{ borderColor: "var(--border-subtle)", color: "var(--accent)" }}
        >
          <Plus size={11} weight="bold" />
          {createMut.isPending ? (
            "Création…"
          ) : (
            <>Créer l&apos;organisation &laquo;&nbsp;{trimmed}&nbsp;&raquo;</>
          )}
        </button>
      )}
    </div>
  );
}
