import React, { useMemo } from "react";
import type { Entity } from "@supernote/core/types";
import type { ViewProps } from "../../types/index.js";
import { queryEntities } from "../../query/index.js";
import { formatFieldValue, getEntityLabel } from "../../utils/field.js";

const DEFAULT_COL_COUNT = 3;

export function GalleryView<T extends Entity = Entity>({
  view,
  entities,
  schema,
  onEntityClick,
  onEntityCreate,
}: ViewProps<T>): React.JSX.Element {
  const colCount = view.cardConfig?.colCount ?? DEFAULT_COL_COUNT;
  const coverFieldId = view.cardConfig?.coverImageFieldId;
  const subtitleFieldId = view.cardConfig?.subtitleFieldId;

  const processed = useMemo(
    () => queryEntities(entities, view.filters ?? [], view.sort ?? []),
    [entities, view.filters, view.sort]
  );

  return (
    <div data-testid="gallery-view" style={{ padding: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${colCount}, 1fr)`,
          gap: 16,
        }}
      >
        {processed.map((entity) => (
          <GalleryCard
            key={entity.id}
            entity={entity}
            label={getEntityLabel(entity, schema)}
            coverSrc={coverFieldId ? String(entity.fields[coverFieldId] ?? "") : undefined}
            subtitle={subtitleFieldId ? formatFieldValue(entity.fields[subtitleFieldId]) : undefined}
            extraFields={view.cardConfig?.fields?.map((fid) => ({
              label: schema.fields.find((f) => f.id === fid)?.label ?? fid,
              value: formatFieldValue(entity.fields[fid]),
            }))}
            onClick={() => onEntityClick?.(entity)}
          />
        ))}
        {onEntityCreate && (
          <button
            data-testid="gallery-create"
            onClick={() => onEntityCreate()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px dashed #cbd5e1",
              borderRadius: 12,
              minHeight: 160,
              cursor: "pointer",
              color: "#94a3b8",
              background: "transparent",
              fontSize: 24,
            }}
            aria-label="Add card"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

interface GalleryCardProps {
  entity: Entity;
  label: string;
  coverSrc?: string;
  subtitle?: string;
  extraFields?: Array<{ label: string; value: string }>;
  onClick: () => void;
}

function GalleryCard({ entity: _entity, label, coverSrc, subtitle, extraFields, onClick }: GalleryCardProps): React.JSX.Element {
  return (
    <div
      data-testid="gallery-card"
      onClick={onClick}
      style={{
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
        overflow: "hidden",
        cursor: "pointer",
        transition: "box-shadow 0.15s",
      }}
    >
      {coverSrc && (
        <div
          style={{
            height: 160,
            background: `url(${coverSrc}) center/cover no-repeat #e2e8f0`,
          }}
          aria-label="Cover image"
        />
      )}
      {!coverSrc && (
        <div
          style={{
            height: 80,
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          }}
        />
      )}
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{label}</div>
        {subtitle && (
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>{subtitle}</div>
        )}
        {extraFields?.map(({ label: fieldLabel, value }) => (
          <div key={fieldLabel} style={{ fontSize: 12, color: "#94a3b8", display: "flex", gap: 4 }}>
            <span>{fieldLabel}:</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
