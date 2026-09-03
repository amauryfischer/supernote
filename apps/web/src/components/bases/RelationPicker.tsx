"use client";

/**
 * RelationPicker — popover searchable pour sélectionner des entités cibles
 * dans un champ Relation.
 *
 * Supporte la cardinalité one_to_one (sélection unique, commit immédiat)
 * et one_to_many / many_to_many (sélection multiple, bouton Confirmer).
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Check, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { RelationField } from "@supernote/core";
import { trpc } from "@/lib/trpc/client";
import type { EntitySummary } from "@supernote/ipc";

interface RelationPickerProps {
  field: RelationField;
  value: unknown;
  onCommit: (next: string | string[]) => void;
  onCancel: () => void;
}

function parseIds(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    if (value.startsWith("[")) {
      try { return (JSON.parse(value) as unknown[]).map(String).filter(Boolean); } catch { /* fall through */ }
    }
    return value ? [value] : [];
  }
  return [];
}

function getTitle(entity: EntitySummary): string {
  const f = entity.fields;
  for (const key of ["name", "title", "titre", "nom"]) {
    const v = f[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  const firstStr = Object.values(f).find((v) => typeof v === "string" && (v as string).trim());
  if (firstStr) return (firstStr as string).slice(0, 60);
  return entity.filePath.split("/").pop()?.replace(/\.md$/i, "") ?? entity.id.slice(0, 8);
}

export function RelationPicker({ field, value, onCommit, onCancel }: RelationPickerProps) {
  const isMulti = field.cardinality !== "one_to_one";
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(() => parseIds(value));
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pass a space so the worker's empty-query fast-path triggers (space trims to "")
  const searchQuery = query.trim() || " ";
  const { data } = trpc.entities.search.useQuery(
    { query: searchQuery, typeId: field.targetTypeId, limit: 30 },
    { placeholderData: (prev) => prev },
  );
  const candidates = data?.items ?? [];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Au click extérieur, on commit l'état courant (sinon le user perd sa sélection).
  // Snapshot stable via ref pour ne pas re-créer le handler à chaque selected.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        const cur = selectedRef.current;
        onCommit(isMulti ? cur : cur[0] ?? "");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onCommit, isMulti]);

  const toggle = (id: string) => {
    if (!isMulti) {
      const next = selected[0] === id ? [] : [id];
      setSelected(next);
      onCommit(next.length ? next[0]! : "");
      return;
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const remove = (id: string) => setSelected((prev) => prev.filter((x) => x !== id));

  const commit = () => {
    onCommit(isMulti ? selected : selected[0] ?? "");
  };

  return (
    <div
      ref={popRef}
      className="absolute z-50 mt-1 flex select-none flex-col overflow-hidden rounded-lg border shadow-lg"
      style={{
        width: 280,
        maxHeight: 380,
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
        userSelect: "none",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        // Évite que le browser démarre une sélection de texte au drag.
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
      }}
    >
      {/* Search input */}
      <div className="border-b p-2" style={{ borderColor: "var(--border-subtle)" }}>
        <div
          className="flex items-center gap-1.5 rounded px-2 py-1"
          style={{ backgroundColor: "var(--surface-2)" }}
        >
          <MagnifyingGlass size={12} style={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-xs outline-none"
            placeholder="Rechercher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
            }}
            style={{ color: "var(--text-primary)" }}
          />
        </div>
      </div>

      {/* Selected chips (multi only) */}
      {isMulti && selected.length > 0 && (
        <div
          className="flex flex-wrap gap-1 border-b px-2 py-1.5"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {selected.map((id) => {
            const entity = candidates.find((c) => c.id === id);
            const label = entity ? getTitle(entity) : id.slice(0, 8) + "…";
            return (
              <span
                key={id}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                style={{ backgroundColor: "var(--accent)" + "22", color: "var(--accent)" }}
              >
                {label}
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => remove(id)}
                  style={{ color: "var(--text-muted)" }}
                  aria-label="Retirer"
                >
                  <X size={9} />
                </Button>
              </span>
            );
          })}
        </div>
      )}

      {/* Candidate list */}
      <div className="flex-1 overflow-y-auto p-1">
        {candidates.length === 0 ? (
          <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Aucun résultat
          </p>
        ) : (
          candidates.map((entity) => {
            const isOn = selected.includes(entity.id);
            return (
              <Button
                key={entity.id}
                variant="ghost"
                size="sm"
                onPress={() => toggle(entity.id)}
                className="flex w-full select-none items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--surface-2)]"
                style={{
                  color: isOn ? "var(--accent)" : "var(--text-secondary)",
                  backgroundColor: isOn ? "var(--surface-3)" : "transparent",
                }}
              >
                <span className="flex-1 truncate">{getTitle(entity)}</span>
                {isOn && <Check size={11} style={{ color: "var(--accent)", flexShrink: 0 }} />}
              </Button>
            );
          })
        )}
      </div>

      {/* Confirm button (multi only) */}
      {isMulti && (
        <div className="border-t p-2" style={{ borderColor: "var(--border-subtle)" }}>
          <Button
            variant="primary"
            size="sm"
            onPress={commit}
            className="w-full rounded py-1 text-xs font-medium"
            style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
          >
            Confirmer ({selected.length} sélectionné{selected.length > 1 ? "s" : ""})
          </Button>
        </div>
      )}
    </div>
  );
}
