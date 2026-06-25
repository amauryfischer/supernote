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

import { useMemo, useState, type ReactNode } from "react";
import { Button, Input } from "@heroui/react";
import {
  requestDatabaseBlockReconfigure,
  type DatabaseViewBlockProps,
  type DatabaseViewRenderer,
} from "@supernote/editor";
import { trpc } from "@/lib/trpc/client";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";
import { BaseView, useViews } from "@/components/bases";
import { getIcon } from "@/components/schemas/icon-map";
import { Plus, Link as LinkIcon, MagnifyingGlass, Table, CaretRight } from "@phosphor-icons/react";

// Shared input chrome for the picker (HeroUI v3 Input is a bare styled field —
// labels live in sibling <label> text, no built-in start adornment).
const PICKER_INPUT_CLS =
  "w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-shadow focus:ring-2 focus:ring-[var(--accent)]";
const PICKER_INPUT_STYLE = {
  borderColor: "var(--border)",
  backgroundColor: "var(--surface-1)",
  color: "var(--text-primary)",
} as const;

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
  const accent = base.color ?? "var(--accent)";
  return (
    <div
      className="flex items-center gap-2 border-b px-3 py-2 text-xs"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
    >
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-md"
        style={{ backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}
      >
        <Icon size={12} weight="fill" />
      </span>
      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{base.plural}</span>
      <span style={{ color: "var(--text-muted)" }}>vue inline</span>
    </div>
  );
}

// ── Picker chrome (shared card shell + header) ─────────────────────────────
//
// The inline `/base` picker is the first thing a user sees when wiring a
// database into a note. It gets a polished card — soft border, layered
// shadow, generous spacing, a glide-in — so it reads as a deliberate surface,
// not a raw form. Both BasePicker and ViewLinkPicker render through it.

function PickerShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="sn-base-picker w-full max-w-md overflow-hidden rounded-xl border"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-0)",
        boxShadow: "0 1px 2px rgb(0 0 0 / 0.04), 0 12px 32px -20px rgb(0 0 0 / 0.22)",
        transition: "var(--sn-transition-glide)",
      }}
    >
      {children}
    </div>
  );
}

function PickerHeader({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3">
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
          {title}
        </p>
        <p className="truncate text-xs leading-tight" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </p>
      </div>
    </div>
  );
}

// Hover affordance without the `.sn-pressable` cascade (avoids the global
// scale-on-press that misbehaves on full-width list rows). Inline so the
// active row keeps its accent tint on hover.
function rowHoverIn(active: boolean) {
  return (e: React.MouseEvent<HTMLElement>) => {
    if (!active) e.currentTarget.style.backgroundColor = "var(--surface-2)";
  };
}
function rowHoverOut(active: boolean) {
  return (e: React.MouseEvent<HTMLElement>) => {
    if (!active) e.currentTarget.style.backgroundColor = "transparent";
  };
}

// ── Picker ────────────────────────────────────────────────────────────────

function BasePicker({ currentId }: { currentId: string }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPlural, setNewPlural] = useState("");
  const [search, setSearch] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const { data: ipcTypes, isLoading } = trpc.schemas.list.useQuery(
    { search: undefined },
    { staleTime: 30_000 },
  );
  const utils = trpc.useUtils();

  const userCount = (ipcTypes ?? []).filter((t) => !t.isSystem).length;
  const systemCount = (ipcTypes ?? []).filter((t) => t.isSystem).length;

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

  // ── Create-base view ──────────────────────────────────────────────────
  if (creating) {
    const canCreate = !!newName.trim() && !createSchema.isPending;
    return (
      <PickerShell>
        <PickerHeader
          icon={<Plus size={15} weight="bold" />}
          title="Nouvelle base"
          subtitle="Nommez-la — vous ajusterez les colonnes ensuite."
        />
        <div className="flex flex-col gap-2.5 px-3.5 pb-3.5">
          <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Nom (singulier)
            <Input
              autoFocus
              placeholder="Client"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNewPlural(e.target.value.trim() ? e.target.value.trim() + "s" : "");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              className={PICKER_INPUT_CLS}
              style={PICKER_INPUT_STYLE}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Pluriel
            <Input
              placeholder="Clients"
              value={newPlural}
              onChange={(e) => setNewPlural(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              className={PICKER_INPUT_CLS}
              style={PICKER_INPUT_STYLE}
            />
          </label>
          {createSchema.error && (
            <p className="text-xs" style={{ color: "var(--danger)" }}>
              {createSchema.error.message}
            </p>
          )}
          <div className="mt-0.5 flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onPress={() => setCreating(false)}>
              Annuler
            </Button>
            <Button
              size="sm"
              onPress={handleCreate}
              isDisabled={!canCreate}
              className="flex items-center gap-1.5"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              {!createSchema.isPending && <Plus size={14} weight="bold" />}
              {createSchema.isPending ? "Création…" : "Créer la base"}
            </Button>
          </div>
        </div>
      </PickerShell>
    );
  }

  // ── Choose-base view ──────────────────────────────────────────────────
  return (
    <PickerShell>
      <PickerHeader
        icon={<Table size={15} weight="duotone" />}
        title="Choisir une base"
        subtitle="Affichez et éditez vos données en tableau, dans la note."
      />

      {userCount > 0 && (
        <div className="relative px-3.5 pb-2">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute left-6 top-2 -translate-y-0 z-10"
            style={{ color: "var(--text-muted)", top: "8px" }}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une base…"
            aria-label="Rechercher une base"
            className={`${PICKER_INPUT_CLS} pl-8`}
            style={PICKER_INPUT_STYLE}
          />
        </div>
      )}

      {/* Base list */}
      <div className="max-h-56 overflow-y-auto px-1.5 pb-1.5">
        {isLoading ? (
          <p className="px-2 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Chargement…
          </p>
        ) : filteredTypes.length === 0 ? (
          <div className="px-2 py-7 text-center">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {search ? "Aucune base ne correspond." : "Aucune base pour l'instant."}
            </p>
            {!search && (
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                Créez-en une pour démarrer.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filteredTypes.map((t) => {
              const Icon = getIcon(t.icon ?? "Database");
              const active = t.id === currentId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => requestReconfigure(t.id, "")}
                  onMouseEnter={rowHoverIn(active)}
                  onMouseLeave={rowHoverOut(active)}
                  className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
                  style={{
                    backgroundColor: active ? "var(--accent-subtle)" : "transparent",
                    transition: "var(--sn-transition-colors)",
                  }}
                >
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: "var(--surface-2)", color: t.color ?? "var(--accent)" }}
                  >
                    <Icon size={13} weight="fill" />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-sm"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {t.plural}
                  </span>
                  {t.isSystem && (
                    <span
                      className="text-[10px] uppercase tracking-wide"
                      style={{ color: "var(--text-muted)" }}
                    >
                      système
                    </span>
                  )}
                  <CaretRight
                    size={13}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: "var(--text-muted)" }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div
        className="flex items-center justify-between gap-2 border-t px-3 py-2.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {systemCount > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setShowSystem((s) => !s)}
            className="text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {showSystem ? "Masquer" : "Afficher"} les bases système ({systemCount})
          </Button>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          onPress={() => {
            setCreating(true);
            setNewName("");
            setNewPlural("");
          }}
          className="flex items-center gap-1.5"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={14} weight="bold" /> Nouvelle base
        </Button>
      </div>
    </PickerShell>
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
    <PickerShell>
      <PickerHeader
        icon={<LinkIcon size={15} weight="bold" />}
        title={`Vue de « ${basePlural} »`}
        subtitle="Liez une vue existante, ou créez-en une dédiée à cette note."
      />

      {/* Existing views */}
      <div className="max-h-44 overflow-y-auto px-1.5 pb-1.5">
        {isLoading ? (
          <p className="px-2 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Chargement…
          </p>
        ) : views.length === 0 ? (
          <p className="px-2 py-5 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Aucune vue encore — créez-en une ci-dessous.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => requestReconfigure(baseId, v.id)}
                onMouseEnter={rowHoverIn(false)}
                onMouseLeave={rowHoverOut(false)}
                className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
                style={{ transition: "var(--sn-transition-colors)" }}
              >
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: "var(--surface-2)", color: "var(--text-secondary)" }}
                >
                  <LinkIcon size={12} />
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-sm"
                  style={{ color: "var(--text-primary)" }}
                >
                  {v.name}
                </span>
                {v.isSystem && (
                  <span
                    className="text-[10px] uppercase tracking-wide"
                    style={{ color: "var(--text-muted)" }}
                  >
                    défaut
                  </span>
                )}
                <CaretRight
                  size={13}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "var(--text-muted)" }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* New dedicated view */}
      <div
        className="flex items-center gap-2 border-t px-3 py-2.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !createView.isPending) createAndLink();
          }}
          aria-label="Nom de la nouvelle vue"
          className={`${PICKER_INPUT_CLS} flex-1`}
          style={PICKER_INPUT_STYLE}
          placeholder={`Vue inline – ${basePlural}`}
        />
        <Button
          size="sm"
          isDisabled={createView.isPending}
          onPress={createAndLink}
          className="flex items-center gap-1.5"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {!createView.isPending && <Plus size={14} weight="bold" />}
          {createView.isPending ? "Création…" : "Créer"}
        </Button>
      </div>
      {createView.error && (
        <p className="px-3.5 pb-2.5 text-xs" style={{ color: "var(--danger)" }}>
          {createView.error.message}
        </p>
      )}
    </PickerShell>
  );
}
