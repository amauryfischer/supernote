"use client";

/**
 * TagSelector — anchored popover that lets the user PICK tags from the
 * existing hierarchy (rather than typing a free-form name).
 *
 * Why this exists:
 *   The previous tag inputs (note header, contact sidebar, new-contact form)
 *   were free-text fields with autocomplete suggestions. With hierarchical
 *   tags (`client/premium/europe`) that flow encouraged typos and forked
 *   trees ("clients" vs "client"). A picker surfaces the canonical tree.
 *
 * Behaviour:
 *   - Trigger button "+ Ajouter un tag" → opens popover anchored under it.
 *   - Search input filters the list as the user types.
 *   - Each row: color swatch dot + indented hierarchical path + checkbox.
 *     Clicking a row toggles selection (immediate, no apply button).
 *   - When the typed query has no exact match, a footer row "Créer le tag
 *     '{query}'" calls `tags.create` then adds the new path to the value.
 *   - Click-outside / Escape closes the popover.
 *
 * Anchored using the same pattern as ColorPickerPopover: position:fixed,
 * naive flip when too close to the viewport edge.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@heroui/react";
import { Plus, MagnifyingGlass, Check, Hash } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";
import type { Tag } from "@supernote/ipc/schemas/tags";

interface TagSelectorProps {
  /** Currently selected tag paths. */
  value: string[];
  /** Called with the new array on every selection change. */
  onChange: (next: string[]) => void;
  /** Optional override for the trigger label. */
  placeholder?: string;
}

export function TagSelector({ value, onChange, placeholder }: TagSelectorProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleOpen = () => {
    if (triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen(true);
  };

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onPress={handleOpen}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-80"
        style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }}
        aria-label={placeholder ?? "Ajouter un tag"}
      >
        <Plus size={10} weight="bold" /> {placeholder ?? "Ajouter un tag"}
      </Button>
      <TagSelectorPopover
        open={open}
        anchorRect={anchorRect}
        value={value}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

interface PopoverProps {
  open: boolean;
  anchorRect: DOMRect | null;
  value: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}

function TagSelectorPopover({ open, anchorRect, value, onChange, onClose }: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const utils = trpc.useUtils();
  const tagsListQuery = trpc.tags.list.useQuery({}, { enabled: open });
  const createMut = trpc.tags.create.useMutation({
    onSuccess: () => {
      void utils.tags.list.invalidate();
    },
  });

  // Click-outside + Escape close the popover. Same pattern as ColorPickerPopover.
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

  const allTags = useMemo<Tag[]>(() => (tagsListQuery.data as Tag[] | undefined) ?? [], [
    tagsListQuery.data,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...allTags].sort((a, b) => a.path.localeCompare(b.path));
    if (!q) return sorted;
    return sorted.filter((t) => t.path.toLowerCase().includes(q));
  }, [allTags, query]);

  const exactMatch = useMemo(
    () => allTags.some((t) => t.path.toLowerCase() === query.trim().toLowerCase()),
    [allTags, query],
  );

  const toggle = (path: string) => {
    if (value.includes(path)) {
      onChange(value.filter((p) => p !== path));
    } else {
      onChange([...value, path]);
    }
  };

  const handleCreate = async () => {
    const path = query.trim();
    if (!path) return;
    try {
      await createMut.mutateAsync({ path });
      if (!value.includes(path)) onChange([...value, path]);
      setQuery("");
    } catch {
      // Silent — user can retry. Avoid disrupting the popover with toasts.
    }
  };

  if (!open || !anchorRect) return null;

  // Naive flip: if popover would overflow viewport edges, anchor inside.
  const POP_W = 260;
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
      aria-label="Choisir un tag"
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
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un tag…"
          className="flex-1 bg-transparent text-xs outline-none"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <p
            className="px-3 py-3 text-center text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {allTags.length === 0 ? "Aucun tag." : "Aucun résultat."}
          </p>
        )}
        {filtered.map((t) => {
          const depth = t.path.split("/").length - 1;
          const selected = value.includes(t.path);
          return (
            <Button
              key={t.path}
              variant="ghost"
              onPress={() => toggle(t.path)}
              className="flex h-auto w-full items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors hover:bg-[var(--surface-2)]"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {t.color ? (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: t.color,
                    border: "1px solid var(--border-subtle)",
                  }}
                />
              ) : (
                <Hash size={11} style={{ color: "var(--text-muted)" }} />
              )}
              <span
                className="flex-1 truncate"
                style={{ color: selected ? "var(--accent)" : "var(--text-secondary)" }}
              >
                {t.path}
              </span>
              {selected && <Check size={11} style={{ color: "var(--accent)" }} />}
            </Button>
          );
        })}
      </div>

      {query.trim() && !exactMatch && (
        <Button
          variant="ghost"
          onPress={handleCreate}
          isDisabled={createMut.isPending}
          className="flex h-auto items-center gap-1.5 border-t px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-2)]"
          style={{ borderColor: "var(--border-subtle)", color: "var(--accent)" }}
        >
          <Plus size={11} weight="bold" />
          {createMut.isPending ? "Création…" : <>Créer le tag &laquo;&nbsp;{query.trim()}&nbsp;&raquo;</>}
        </Button>
      )}
    </div>
  );
}
