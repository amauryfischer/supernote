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
import { Button, Input, Checkbox } from "@heroui/react";
import {
  requestDatabaseBlockReconfigure,
  type DatabaseViewBlockProps,
  type DatabaseViewRenderer,
} from "@supernote/editor";
import { trpc } from "@/lib/trpc/client";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";
import { BaseView, useViews } from "@/components/bases";
import { getIcon } from "@/components/schemas/icon-map";
import { Plus, Link as LinkIcon, Database } from "@phosphor-icons/react";

/** Public entry — pass this to <DatabaseViewProvider renderer={...} />. */
export const renderInlineDatabase: DatabaseViewRenderer = (props) => (
  <InlineDatabase {...props} />
);

function InlineDatabase({ baseId, viewId }: DatabaseViewBlockProps) {
  // staleTime — chaque bloc databaseView monte sa propre query. Sans cache,
  // une note avec N blocs déclenche N refetches à chaque action. On laisse
  // React Query dédupliquer les fenêtres de 30 s.
  const { data: ipcTypes } = trpc.schemas.list.useQuery(
    { search: undefined },
    { staleTime: 30_000 },
  );
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
      <InlineBaseHeader base={base} />
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
  base,
}: {
  base: { name: string; plural: string; icon?: string; color?: string };
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
    </div>
  );
}

// ── Picker ────────────────────────────────────────────────────────────────

function BasePicker({ currentId }: { currentId: string }) {
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPlural, setNewPlural] = useState("");
  const [search, setSearch] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const { data: ipcTypes, isLoading } = trpc.schemas.list.useQuery(
    { search: undefined },
    { staleTime: 30_000 },
  );
  const utils = trpc.useUtils();

  // Liste utilisateur d'abord, system masqué par défaut. Recherche fuzzy
  // simple sur name + plural pour scaler à beaucoup de Bases.
  const filteredTypes = useMemo(() => {
    const all = ipcTypes ?? [];
    const q = search.trim().toLowerCase();
    return all
      .filter((t) => showSystem || !t.isSystem)
      .filter((t) => {
        if (!q) return true;
        return (
          t.name.toLowerCase().includes(q) ||
          (t.plural ?? "").toLowerCase().includes(q)
        );
      });
  }, [ipcTypes, search, showSystem]);

  const systemCount = (ipcTypes ?? []).filter((t) => t.isSystem).length;

  const createSchema = trpc.schemas.create.useMutation({
    onSuccess: async (created) => {
      // Invalider le cache avant de reconfigurer — sinon InlineDatabase ne
      // trouve pas le nouveau schéma dans la query cache et repasse au picker.
      await utils.schemas.list.invalidate();
      if (created?.id) requestReconfigure(created.id, "");
    },
  });

  const handleCreate = () => {
    const name = newName.trim();
    if (!name || createSchema.isPending) return;
    const plural = newPlural.trim() || name + "s";
    createSchema.mutate({
      name,
      plural,
      defaultPath: name.toLowerCase().replace(/\s+/g, "-"),
      fileNamePattern: "{id}",
    });
  };

  const openCreateForm = () => {
    setCreating(true);
    setNewName("");
    setNewPlural("");
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  if (!open) {
    return (
      <Button
        onPress={() => setOpen(true)}
        className="block w-full rounded border border-dashed px-3 py-3 text-center text-xs"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
          backgroundColor: "var(--surface-1)",
        }}
      >
        Sélectionner une Base à afficher
      </Button>
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

      {/* Search input */}
      <Input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Rechercher parmi ${(ipcTypes ?? []).filter((t) => showSystem || !t.isSystem).length} Bases…`}
        aria-label="Rechercher une Base"
        className="mb-2 w-full rounded border bg-transparent px-2 py-1 text-xs"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
      />

      {/* Existing bases */}
      {isLoading ? (
        <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>Chargement…</p>
      ) : filteredTypes.length === 0 ? (
        <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {search ? "Aucun résultat." : "Aucune Base — créez-en une."}
        </p>
      ) : (
        <div
          className="mb-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto"
        >
          {filteredTypes.map((t) => (
            <Button
              key={t.id}
              onPress={() => requestReconfigure(t.id, "")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
              style={{
                backgroundColor: t.id === currentId ? "var(--surface-3)" : "transparent",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {t.icon ? t.icon : <Database size={11} />}
              {" "}{t.plural}
              {t.isSystem && (
                <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>·sys</span>
              )}
            </Button>
          ))}
        </div>
      )}

      {systemCount > 0 && (
        <Checkbox
          isSelected={showSystem}
          onChange={setShowSystem}
          className="mb-2 flex cursor-pointer items-center gap-1.5 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          Afficher les Bases système ({systemCount})
        </Checkbox>
      )}

      {/* Create new base form */}
      {!creating ? (
        <Button
          onPress={openCreateForm}
          className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--accent)",
          }}
        >
          <Plus size={11} /> Nouvelle Base
        </Button>
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
                if (e.key === "Enter" && !createSchema.isPending) handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              aria-label="Nom de la Base"
              className="rounded border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
            />
            <input
              type="text"
              placeholder="Pluriel (ex : Clients)"
              value={newPlural}
              onChange={(e) => setNewPlural(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !createSchema.isPending) handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              aria-label="Nom pluriel de la Base"
              className="rounded border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
            />
            {createSchema.error && (
              <p className="text-[11px]" style={{ color: "var(--destructive)" }}>
                Erreur : {createSchema.error.message}
              </p>
            )}
            <div className="flex items-center justify-end gap-1.5 pt-0.5">
              <Button
                onPress={() => setCreating(false)}
                className="rounded px-2 py-1 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Annuler
              </Button>
              <Button
                onPress={handleCreate}
                isDisabled={!newName.trim() || createSchema.isPending}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "var(--accent-foreground)",
                  opacity: !newName.trim() || createSchema.isPending ? 0.5 : 1,
                }}
              >
                <Plus size={10} /> {createSchema.isPending ? "Création…" : "Créer"}
              </Button>
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
  const [newName, setNewName] = useState(`Vue inline – ${basePlural}`);

  const createView = trpc.views.create.useMutation({
    onSuccess: (created) => {
      if (created?.id) requestReconfigure(baseId, created.id);
    },
  });

  const createAndLink = () => {
    if (createView.isPending) return;
    createView.mutate({
      typeId: baseId,
      name: newName.trim() || `Vue inline – ${basePlural}`,
      kind: "table",
    });
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
            <Button
              key={v.id}
              onPress={() => requestReconfigure(baseId, v.id)}
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
            </Button>
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
          <Input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !createView.isPending) createAndLink();
            }}
            aria-label="Nom de la nouvelle vue"
            className="flex-1 rounded border bg-transparent px-1.5 py-1 text-xs"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
            placeholder={`Vue inline – ${basePlural}`}
          />
          <Button
            isDisabled={createView.isPending}
            onPress={createAndLink}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
              opacity: createView.isPending ? 0.6 : 1,
            }}
          >
            <Plus size={10} /> {createView.isPending ? "Création…" : "Créer"}
          </Button>
        </div>
        {createView.error && (
          <p className="mt-1 text-[11px]" style={{ color: "var(--destructive)" }}>
            Erreur : {createView.error.message}
          </p>
        )}
      </div>
    </div>
  );
}
