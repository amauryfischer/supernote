"use client";

/**
 * InlineDatabaseRenderer — host-side renderer plugged into the BlockNote
 * `databaseView` block via <DatabaseViewProvider>.
 *
 * When a block is freshly inserted, `baseId` is empty — we show a small
 * inline picker prompting the user to choose a Base + view. Once both are
 * set, we hand off to <BaseView pinnedViewId=…/> which renders the actual
 * grid.
 *
 * The picker writes into the block by calling editor.updateBlock(...).
 * We can't easily get the editor reference from inside the block render
 * callback (BlockNote's createReactBlockSpec doesn't pass it), so we fall
 * back to firing a CustomEvent that the editor host listens to. Pragmatic
 * — keeps the @supernote/editor package agnostic of how the host resolves
 * picks.
 */

import { useMemo, useRef, useState } from "react";
import {
  requestDatabaseBlockReconfigure,
  type DatabaseViewBlockProps,
  type DatabaseViewRenderer,
} from "@supernote/editor";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";
import { BaseView, useViews } from "@/components/bases";
import { getIcon } from "@/components/schemas/icon-map";
import { Plus, Link as LinkIcon, Database } from "@phosphor-icons/react";

/** Public entry — pass this to <DatabaseViewProvider renderer={...} />. */
export const renderInlineDatabase: DatabaseViewRenderer = (props) => (
  <InlineDatabase {...props} />
);

function InlineDatabase({ baseId, viewId }: DatabaseViewBlockProps) {
  const { data: ipcTypes } = trpc.schemas.list.useQuery({ search: undefined });
  const ipcType = ipcTypes?.find((t) => t.id === baseId);
  const base = useMemo(
    () => (ipcType ? ipcEntityTypeToCore(ipcType) : undefined),
    [ipcType],
  );

  // No Base yet → pick one.
  if (!base) {
    return <BasePicker currentId={baseId} />;
  }
  // Base chosen but no specific view → pick a view linkage strategy.
  if (!viewId) {
    return <ViewLinkPicker baseId={baseId} basePlural={base.plural} />;
  }

  return (
    <div
      className="sn-database-block-host"
      style={{
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        backgroundColor: "var(--surface-0)",
        overflow: "hidden",
      }}
    >
      <InlineBaseHeader baseId={baseId} base={base} viewId={viewId} />
      <div style={{ maxHeight: 480, overflow: "auto" }}>
        <BaseView
          base={base}
          pinnedViewId={viewId || undefined}
          maxHeight="100%"
        />
      </div>
    </div>
  );
}

// ── Header (Base name + picker affordance) ────────────────────────────────

function InlineBaseHeader({
  baseId,
  base,
  viewId,
}: {
  baseId: string;
  base: { name: string; plural: string; icon?: string; color?: string };
  viewId: string;
}) {
  const Icon = getIcon(base.icon ?? "Database");
  return (
    <div
      className="flex items-center gap-2 border-b px-3 py-1.5 text-xs"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      <Icon size={12} style={{ color: base.color ?? "var(--accent)" }} weight="fill" />
      <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{base.plural}</span>
      <span style={{ color: "var(--text-muted)" }}>· vue inline</span>
      <button
        type="button"
        onClick={() => requestReconfigure(baseId, viewId)}
        className="ml-auto rounded px-1.5 py-0.5 hover:bg-[var(--surface-2)]"
        style={{ color: "var(--text-muted)" }}
        title="Changer de Base"
      >
        Changer
      </button>
    </div>
  );
}

// ── Picker ────────────────────────────────────────────────────────────────

function BasePicker({ currentId }: { currentId: string }) {
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPlural, setNewPlural] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const { data: ipcTypes, isLoading } = trpc.schemas.list.useQuery({ search: undefined });

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const plural = newPlural.trim() || name + "s";
    setSubmitting(true);
    try {
      const created = await trpcVanillaClient.schemas.create.mutate({
        name,
        plural,
        defaultPath: name.toLowerCase().replace(/\s+/g, "-"),
        fileNamePattern: "{id}",
      });
      if (created && typeof created === "object" && "id" in created) {
        requestReconfigure((created as { id: string }).id, "");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openCreateForm = () => {
    setCreating(true);
    setNewName("");
    setNewPlural("");
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full rounded border border-dashed px-3 py-3 text-center text-xs"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
          backgroundColor: "var(--surface-1)",
        }}
      >
        Sélectionner une Base à afficher
      </button>
    );
  }

  return (
    <div
      className="rounded border px-3 py-3"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      <p className="mb-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        Choisir ou créer une Base
      </p>

      {/* Existing bases */}
      {isLoading ? (
        <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>Chargement…</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(ipcTypes ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => requestReconfigure(t.id, "")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
              style={{
                backgroundColor: t.id === currentId ? "var(--surface-3)" : "transparent",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {t.icon ? t.icon : <Database size={11} />}
              {" "}{t.plural}
            </button>
          ))}
        </div>
      )}

      {/* Create new base form */}
      {!creating ? (
        <button
          type="button"
          onClick={openCreateForm}
          className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--accent)",
          }}
        >
          <Plus size={11} /> Nouvelle Base
        </button>
      ) : (
        <div
          className="mt-1 rounded border p-2"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
        >
          <p
            className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            Nouvelle Base
          </p>
          <div className="flex flex-col gap-1.5">
            <input
              ref={nameRef}
              type="text"
              placeholder="Nom (ex : Client)"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNewPlural(e.target.value.trim() + "s");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting) void handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              className="rounded border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
            />
            <input
              type="text"
              placeholder="Pluriel (ex : Clients)"
              value={newPlural}
              onChange={(e) => setNewPlural(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting) void handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              className="rounded border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
            />
            <div className="flex items-center justify-end gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded px-2 py-1 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim() || submitting}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "var(--accent-foreground)",
                  opacity: !newName.trim() || submitting ? 0.5 : 1,
                }}
              >
                <Plus size={10} /> {submitting ? "Création…" : "Créer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Reconfigure requests are routed through `requestDatabaseBlockReconfigure`
// in @supernote/editor — SupernoteEditor installs the matching listener on
// its own editor instance via `useDatabaseBlockPickListener`. We just dispatch.

function requestReconfigure(nextBaseId: string, nextViewId: string): void {
  requestDatabaseBlockReconfigure({ nextBaseId, nextViewId });
}

// ── ViewLinkPicker ────────────────────────────────────────────────────────
//
// After picking a Base, the user chooses HOW to view it inline:
//   - "Lier à une vue existante" → picks one of the named views (incl. default)
//   - "Nouvelle vue dédiée"      → creates a fresh persisted view and binds to it
//
// This mirrors Coda's mental model: every visible projection of a Base is
// a real, persisted view — the inline placement is just where it's rendered.

function ViewLinkPicker({
  baseId,
  basePlural,
}: {
  baseId: string;
  basePlural: string;
}) {
  const { data: views = [], isLoading } = useViews(baseId);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(`Vue inline – ${basePlural}`);

  const createAndLink = async () => {
    setCreating(true);
    try {
      const created = await trpcVanillaClient.views.create.mutate({
        typeId: baseId,
        name: newName.trim() || `Vue inline – ${basePlural}`,
        kind: "table",
      });
      if (created && typeof created === "object" && "id" in created) {
        requestReconfigure(baseId, (created as { id: string }).id);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="rounded border px-3 py-3"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      <p className="mb-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        Choisir une vue de « {basePlural} »
      </p>

      {/* Existing views */}
      {isLoading ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Chargement…
        </p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => requestReconfigure(baseId, v.id)}
              className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-[var(--surface-2)]"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <LinkIcon size={10} />
              {v.name}
              {v.isSystem && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  (par défaut)
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* New view */}
      <div
        className="rounded border-dashed border p-2"
        style={{
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--surface-0)",
        }}
      >
        <p
          className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          Nouvelle vue dédiée
        </p>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creating) void createAndLink();
            }}
            className="flex-1 rounded border bg-transparent px-1.5 py-1 text-xs"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
            placeholder={`Vue inline – ${basePlural}`}
          />
          <button
            type="button"
            disabled={creating}
            onClick={createAndLink}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
              opacity: creating ? 0.6 : 1,
            }}
          >
            <Plus size={10} /> Créer
          </button>
        </div>
      </div>
    </div>
  );
}
