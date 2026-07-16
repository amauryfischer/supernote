"use client";

/**
 * EntityCard — compact summary card shared by Kanban, Gallery and List views.
 *
 * Renders the entity's title, cover image (when available), and a handful of
 * secondary fields formatted by `Cell` so the styling matches the table grid.
 * Clicking the card triggers `onOpen` when a view provides one, otherwise it
 * opens the entity in the shell side-peek via the `supernote:open-peek` event
 * (so Gallery / Kanban / List get the peek for free). `draggable` enables
 * HTML5 drag for Kanban.
 */

import type { EntityType } from "@supernote/core";
import { useState } from "react";
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
  // Local drag flag so the card can ease its own pickup cue. Native HTML5 DnD
  // renders a detached drag image, so the source node never receives a
  // dnd-kit-style transform — we're free to glide a subtle lift on the node
  // itself and let it settle back to rest when the drag ends.
  const [isDragging, setIsDragging] = useState(false);

  // Ouverture : la vue peut fournir un `onOpen` explicite ; sinon on déclenche
  // le side-peek du shell via un CustomEvent window (aucun prop-drilling requis
  // depuis Gallery / Kanban / List).
  const handleOpen = () => {
    if (onOpen) {
      onOpen(entity.id);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("supernote:open-peek", {
        detail: { baseId: base.id, entityId: entity.id },
      }),
    );
  };

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
      role="button"
      tabIndex={0}
      aria-label={`Ouvrir ${title}`}
      className="sn-base-card sn-motion-colors group relative cursor-pointer rounded-md border hover:border-[var(--accent)] focus-visible:outline-none focus-visible:border-[var(--accent)]"
      style={{
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
        overflow: "hidden",
        // Settle the pickup cue: opacity eases with the standard easing while
        // the lift glides back to rest. Both stay <=--sn-dur-3 so the drop
        // feels immediate but liquid. There's no concurrent dnd-kit transform
        // to fight — native DnD leaves the source node untouched mid-drag.
        opacity: isDragging ? 0.4 : 1,
        transform: isDragging ? "scale(0.97)" : "scale(1)",
        transition:
          "var(--sn-transition-opacity), transform var(--sn-dur-3) var(--sn-ease-glide)",
      }}
      draggable={!!onDragStart}
      onDragStart={
        onDragStart
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", entity.id);
              setIsDragging(true);
              onDragStart(entity.id);
            }
          : undefined
      }
      onDragEnd={() => {
        setIsDragging(false);
        onDragEnd?.();
      }}
      onClick={handleOpen}
      // Clavier : la carte devient un vrai bouton (Kanban/Gallery/List étaient
      // pilotables uniquement à la souris). Le garde `target === currentTarget`
      // évite de capturer Entrée/Espace quand le focus est dans un Cell éditable.
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleOpen();
        }
      }}
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
