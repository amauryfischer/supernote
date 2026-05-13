"use client";

/**
 * EntityCard — compact summary card shared by Kanban, Gallery and List views.
 *
 * Renders the entity's title, cover image (when available), and a handful of
 * secondary fields formatted by `Cell` so the styling matches the table grid.
 * Clicking the card triggers `onOpen` (typically the view's row-open
 * callback). `draggable` enables HTML5 drag for Kanban.
 */

import type { EntityType } from "@supernote/core";
import { Cell } from "./Cell";
import {
  deriveCardTitle,
  findCoverField,
  readCoverUrl,
  secondaryFields,
} from "./entity-summary";

interface EntityCardProps {
  base: EntityType;
  entity: {
    id: string;
    filePath: string;
    fields: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  /** Order of secondary fields to display (visibleFields from the view). */
  visibleFieldIds: string[];
  onOpen?: (entityId: string) => void;
  /** When set, the card is draggable and fires this when dropped. */
  onDragStart?: (entityId: string) => void;
  onDragEnd?: () => void;
  /** Optional callback for inline field edits from the card body. */
  onEditField?: (entityId: string, fieldId: string, value: unknown) => void;
  /** Compact mode used by lists (no cover, tight padding). */
  compact?: boolean;
}

export function EntityCard({
  base,
  entity,
  visibleFieldIds,
  onOpen,
  onDragStart,
  onDragEnd,
  onEditField,
  compact,
}: EntityCardProps) {
  const title = deriveCardTitle(entity, base);
  const cover = compact ? null : findCoverField(base);
  const coverUrl = cover ? readCoverUrl(entity, cover) : undefined;

  // Secondary fields: limit to 4 so cards stay compact. We honor the view's
  // visibleFieldIds order when present so users feel in control of what
  // shows on a card (same setting as the table's visible columns).
  const fieldsById = new Map(base.fields.map((f) => [f.id, f]));
  const orderedSecondary = visibleFieldIds.length > 0
    ? visibleFieldIds
        .map((fid) => fieldsById.get(fid))
        .filter((f): f is NonNullable<typeof f> => Boolean(f))
        .filter((f) => f.kind !== "longtext" && f.kind !== "markdown")
    : secondaryFields(base, { max: compact ? 2 : 4 });
  const visibleSecondary = orderedSecondary
    .filter((f) => {
      const titleId = findTitleId(base);
      if (titleId && f.id === titleId) return false;
      if (cover && f.id === cover.id) return false;
      return true;
    })
    .slice(0, compact ? 2 : 4);

  return (
    <div
      className="sn-base-card group relative cursor-pointer rounded-md border transition-colors hover:border-[var(--accent)]"
      style={{
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
        overflow: "hidden",
      }}
      draggable={!!onDragStart}
      onDragStart={
        onDragStart
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", entity.id);
              onDragStart(entity.id);
            }
          : undefined
      }
      onDragEnd={onDragEnd}
      onClick={() => onOpen?.(entity.id)}
    >
      {coverUrl && (
        <div
          className="aspect-[16/9] w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${escapeCssUrl(coverUrl)})` }}
        />
      )}
      <div className={`flex flex-col gap-1 ${compact ? "px-2 py-1.5" : "px-3 py-2"}`}>
        <h4
          className={`line-clamp-2 ${compact ? "text-xs" : "text-sm"} font-semibold`}
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h4>
        {visibleSecondary.length > 0 && (
          <div className="flex flex-col gap-0.5 text-xs">
            {visibleSecondary.map((field) => (
              <div key={field.id} className="flex items-center gap-1.5">
                <span
                  className="shrink-0 text-[10px] uppercase tracking-wide"
                  style={{ color: "var(--text-muted)", minWidth: 50 }}
                >
                  {field.label || field.name}
                </span>
                <div className="min-w-0 flex-1">
                  <Cell
                    field={field}
                    value={entity.fields[field.id]}
                    onChange={(next) => onEditField?.(entity.id, field.id, next)}
                    readOnly={!onEditField}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function findTitleId(base: EntityType): string | null {
  const tf = base.fields.find((f) => {
    const id = (f.id || "").toLowerCase();
    return id.endsWith("title") || id.endsWith("name") || id.endsWith("titre");
  });
  return tf?.id ?? null;
}

function escapeCssUrl(url: string): string {
  // Defensive: prevent breaking out of the url() expression with a quote
  // or paren. Image URLs commonly have query strings so escape minimally.
  return url.replace(/["()\\]/g, "\\$&");
}
