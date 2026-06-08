"use client";

import { Command } from "cmdk";
import {
  BookOpen,
  Calendar,
  FileText,
  Hash,
  SidebarSimple,
  Plus,
  MagnifyingGlass,
  Gear,
  Sun,
  Users,
  Lightning,
  Folder,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { registry } from "@/lib/commands/registry";
import type { Command as AppCommand } from "@/lib/commands/types";
import { useDebounce } from "@/hooks/useDebounce";
import { trpc, hasWorkerBackend } from "@/lib/trpc/client";
import { isWorkerReady } from "@/lib/trpc/browser-link";
import type { SearchResult } from "@supernote/ipc";
import { CommandPreview } from "./CommandPreview";

// ---------------------------------------------------------------------------
// Icon resolver — maps seed icon names to Lucide components
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, PhosphorIcon> = {
  "file-plus": Plus,
  "file-text": FileText,
  "calendar": Calendar,
  "search": MagnifyingGlass,
  "users": Users,
  "hash": Hash,
  "settings": Gear,
  "panel-left": SidebarSimple,
  "panel-right": SidebarSimple,
  "sun": Sun,
  "zap": Lightning,
  "book-open": BookOpen,
};

function CommandIcon({ name, size = 15 }: { name?: string; size?: number }) {
  if (!name) return null;
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return <Icon size={size} />;
}

// ---------------------------------------------------------------------------
// Shortcut hint renderer
// ---------------------------------------------------------------------------

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform);

function ShortcutHint({ keys }: { keys: string }) {
  const parts = keys
    .split("+")
    .map((k) => {
      if (k === "mod") return isMac ? "⌘" : "Ctrl";
      if (k === "shift") return "⇧";
      if (k === "alt") return isMac ? "⌥" : "Alt";
      return k.toUpperCase();
    });

  return (
    <span className="flex items-center gap-0.5">
      {parts.map((p, i) => (
        <kbd
          key={i}
          className="rounded px-1.5 py-0.5 text-[10px] font-mono"
          style={{
            backgroundColor: "var(--surface-3)",
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
          }}
        >
          {p}
        </kbd>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Group labels
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<string, string> = {
  creation: "Créer",
  navigation: "Navigation",
  editing: "Édition",
  view: "Affichage",
  tools: "Outils",
  plugin: "Plugins",
};

// ---------------------------------------------------------------------------
// Entity routing — keep in sync with shell/RightPanel and notes/NoteCanvasView
// ---------------------------------------------------------------------------

function entityHref(entityId: string, typeId: string): string {
  const t = typeId.toLowerCase();
  if (t === "personne" || t === "contact") return `/contacts/${entityId}`;
  if (t === "note") return `/notes/${entityId}`;
  // Fallback: every entity has a notes-style detail page in the current
  // routing layout, so /notes/{id} surfaces something useful even for
  // types without a dedicated route (organisation, ressource, …).
  return `/notes/${entityId}`;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  note: "Notes",
  personne: "Contacts",
  contact: "Contacts",
  organisation: "Organisations",
  ressource: "Ressources",
  journal: "Journal",
};

function entityGroupLabel(typeId: string, fallback: string): string {
  return ENTITY_TYPE_LABELS[typeId.toLowerCase()] ?? fallback;
}

// ---------------------------------------------------------------------------
// CommandPalette component
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  // Item actif (surligné) selon cmdk. cmdk n'appelle `onValueChange` qu'en mode
  // contrôlé : on pilote donc `value` nous-mêmes. Comme cmdk met aussi à jour la
  // valeur sur `onPointerMove`, cet état suit À LA FOIS la nav clavier ET le
  // survol souris — une seule source de vérité pour l'aperçu.
  const [activeValue, setActiveValue] = useState("");
  const router = useRouter();

  // Reset query + sélection à l'ouverture
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveValue("");
    }
  }, [open]);

  const allCommands = useMemo(() => registry.list(), [open]);

  // Worker readiness — same gate as /recherche, /notes. Without this the
  // entity search query rejects with "Vault not initialized" and stays in
  // an error state forever (retry: false).
  const [workerReady, setWorkerReady] = useState(() =>
    typeof window === "undefined" ? false : isWorkerReady(),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isWorkerReady()) setWorkerReady(true);
    const onReady = () => setWorkerReady(true);
    window.addEventListener("supernote:vault-ready", onReady);
    return () => window.removeEventListener("supernote:vault-ready", onReady);
  }, []);

  // Debounce so we don't hit the worker on every keystroke. 200 ms is short
  // enough to feel instant, long enough to coalesce a normal typing burst.
  const debouncedQuery = useDebounce(query, 200);
  const trimmedQuery = debouncedQuery.trim();
  const canSearchEntities =
    open && hasWorkerBackend() && workerReady && trimmedQuery.length > 0;

  // Reuse search.query (rich SearchResult) — same source as /recherche.
  const entitySearch = trpc.search.query.useQuery(
    { query: trimmedQuery, limit: 30, offset: 0 },
    { enabled: canSearchEntities, retry: false, staleTime: 30_000 },
  );

  const entityResults = useMemo<SearchResult[]>(() => {
    if (!canSearchEntities) return [];
    return (entitySearch.data?.items ?? []) as SearchResult[];
  }, [canSearchEntities, entitySearch.data]);

  // Diagnostic — surface why the palette is empty when it shouldn't be.
  // Logs on every state transition so the developer console shows the
  // chain (workerReady? canSearchEntities? data?.items.length?). Cheap;
  // can be removed once the integration is confirmed in the wild.
  useEffect(() => {
    if (!open || !trimmedQuery) return;
    console.info("[CommandPalette]", {
      query: trimmedQuery,
      hasWorkerBackend: hasWorkerBackend(),
      workerReady,
      canSearchEntities,
      isLoading: entitySearch.isLoading,
      isFetching: entitySearch.isFetching,
      isError: entitySearch.isError,
      error: entitySearch.error?.message ?? null,
      itemsCount: entitySearch.data?.items?.length ?? null,
      total: entitySearch.data?.total ?? null,
    });
  }, [
    open,
    trimmedQuery,
    workerReady,
    canSearchEntities,
    entitySearch.isLoading,
    entitySearch.isFetching,
    entitySearch.isError,
    entitySearch.error,
    entitySearch.data,
  ]);

  // Group entities by typeId. Most-frequent types first, with a stable
  // priority order so the layout doesn't jump around as results stream in.
  const entityGroups = useMemo(() => {
    const map = new Map<string, { typeName: string; items: SearchResult[] }>();
    for (const r of entityResults) {
      const bucket = map.get(r.typeId);
      if (bucket) bucket.items.push(r);
      else map.set(r.typeId, { typeName: r.typeName || r.typeId, items: [r] });
    }
    const priority = ["note", "personne", "organisation"];
    return [...map.entries()].sort(([a], [b]) => {
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [entityResults]);

  // L'aperçu cible l'item actif uniquement si c'est une entité. Les valeurs
  // entité sont préfixées `entity:` (cf. EntityCommandItem) ; cmdk préserve la
  // casse (ULID en majuscules), donc on extrait l'id tel quel.
  const activeEntityId = activeValue.startsWith("entity:")
    ? activeValue.slice("entity:".length)
    : null;
  const activeResult = useMemo(
    () =>
      activeEntityId
        ? entityResults.find((r) => r.entityId === activeEntityId) ?? null
        : null,
    [activeEntityId, entityResults],
  );
  // Colonne d'aperçu réservée dès qu'une recherche remonte des entités : évite
  // que la modale ne saute en largeur quand on passe d'une note à une commande.
  // Le contenu reste vide gracieusement si l'item actif n'est pas une entité.
  const showPreviewColumn = entityResults.length > 0;

  const handleSelect = useCallback(
    async (cmdId: string) => {
      onClose();
      await registry.execute(cmdId);
    },
    [onClose],
  );

  const handleEntitySelect = useCallback(
    (entityId: string, typeId: string) => {
      onClose();
      router.push(entityHref(entityId, typeId));
    },
    [onClose, router],
  );

  if (!open) return null;

  // Group commands
  const grouped = allCommands.reduce<Record<string, AppCommand[]>>((acc, cmd) => {
    const g = cmd.group ?? "tools";
    if (!acc[g]) acc[g] = [];
    acc[g]!.push(cmd);
    return acc;
  }, {});

  const groupOrder: string[] = ["creation", "navigation", "view", "tools", "editing", "plugin"];

  // Manual command filter: cmdk's built-in shouldFilter is disabled below
  // so the entity results (which the worker already filtered server-side)
  // don't get filtered again client-side. We re-implement the same matching
  // for commands here so the palette still narrows commands as you type.
  const cmdQuery = trimmedQuery.toLowerCase();
  const matchCommand = (cmd: AppCommand): boolean => {
    if (!cmdQuery) return true;
    const haystack = [cmd.label, cmd.description ?? "", ...(cmd.keywords ?? [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(cmdQuery);
  };

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{
        paddingTop: "12vh",
        backgroundColor: "oklch(0.14 0.006 260 / 0.4)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal — s'élargit pour accueillir l'aperçu quand des entités matchent */}
      <div
        className="w-full overflow-hidden shadow-2xl transition-[max-width] duration-150"
        style={{
          maxWidth: showPreviewColumn ? "780px" : "600px",
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-xl)",
          animation: "cmdpalette-in 120ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <Command
          label="Command palette"
          loop
          shouldFilter={false}
          // Mode contrôlé : indispensable pour recevoir `onValueChange`.
          value={activeValue}
          onValueChange={setActiveValue}
          className="flex flex-col"
        >
          {/* Search input */}
          <div
            className="flex items-center gap-3 px-4"
            style={{
              borderBottom: "1px solid var(--border-subtle)",
              height: "52px",
            }}
          >
            <MagnifyingGlass
              size={16}
              style={{ color: "var(--text-muted)", flexShrink: 0 }}
            />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Tapez une commande, cherchez une note, ou créez quelque chose…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
              style={{ color: "var(--text-primary)" }}
              autoFocus
            />
            <kbd
              className="rounded px-1.5 py-0.5 text-[10px] font-mono"
              style={{
                backgroundColor: "var(--surface-3)",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
              }}
            >
              Esc
            </kbd>
          </div>

          {/* Corps : liste à gauche + aperçu (Raycast) à droite */}
          <div className="flex min-h-0">
          {/* Results */}
          <Command.List
            className="min-w-0 flex-1 max-h-[420px] overflow-y-auto py-2"
            style={{ scrollbarWidth: "thin" }}
          >
            <Command.Empty
              className="py-8 text-center text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              {canSearchEntities && entitySearch.isFetching && entityResults.length === 0
                ? "Recherche…"
                : `Aucun résultat pour "${query}"`}
            </Command.Empty>

            {/* Entity results — surfaced first when the user is searching, so
                "leroy merlin" → notes/contacts appear above the (lower-signal)
                command matches. Hidden when query is empty. */}
            {trimmedQuery.length > 0 &&
              entityGroups.map(([typeId, group]) => (
                <Command.Group
                  key={`entity-${typeId}`}
                  heading={entityGroupLabel(typeId, group.typeName)}
                  className="px-2"
                >
                  {group.items.map((r) => (
                    <EntityCommandItem
                      key={r.entityId}
                      result={r}
                      onSelect={handleEntitySelect}
                    />
                  ))}
                </Command.Group>
              ))}

            {/* Command groups — always rendered, filtered manually because
                cmdk's built-in filter is off. */}
            {groupOrder.map((groupKey) => {
              const cmds = (grouped[groupKey] ?? []).filter(matchCommand);
              if (!cmds.length) return null;
              return (
                <Command.Group
                  key={groupKey}
                  heading={GROUP_LABELS[groupKey] ?? groupKey}
                  className="px-2"
                >
                  {cmds.map((cmd) => (
                    <CommandItem
                      key={cmd.id}
                      cmd={cmd}
                      onSelect={handleSelect}
                    />
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>

          {/* Aperçu live — masqué sous `sm`, décoratif (aria-hidden interne). */}
          {showPreviewColumn && (
            <div
              className="hidden sm:flex w-[340px] shrink-0 flex-col max-h-[420px]"
              style={{ borderLeft: "1px solid var(--border-subtle)" }}
            >
              <CommandPreview entityId={activeEntityId} activeResult={activeResult} />
            </div>
          )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between px-4 py-2 text-[11px]"
            style={{
              borderTop: "1px solid var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            <span className="flex items-center gap-3">
              <span>
                <kbd className="font-mono">↑↓</kbd> naviguer
              </span>
              <span>
                <kbd className="font-mono">↵</kbd> sélectionner
              </span>
              <span>
                <kbd className="font-mono">Esc</kbd> fermer
              </span>
            </span>
            <span style={{ color: "var(--accent)" }}>Supernote</span>
          </div>
        </Command>
      </div>

      <style>{`
        @keyframes cmdpalette-in {
          from { opacity: 0; transform: scale(0.97) translateY(-4px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        [cmdk-group-heading] {
          padding: 4px 8px 2px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
        }
        [cmdk-group]:not([hidden]) ~ [cmdk-group] {
          margin-top: 4px;
        }
        [cmdk-item][data-selected="true"] {
          background-color: var(--accent-subtle);
          color: var(--accent);
        }
        [cmdk-item][data-selected="true"] [data-cmd-icon] {
          background-color: oklch(0.55 0.24 295 / 0.2);
          color: var(--accent);
        }
        [cmdk-item]:hover:not([aria-disabled="true"]) {
          background-color: var(--surface-2);
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommandItem
// ---------------------------------------------------------------------------

function CommandItem({
  cmd,
  onSelect,
}: {
  cmd: AppCommand;
  onSelect: (id: string) => void;
}) {
  return (
    <Command.Item
      value={cmd.id}
      keywords={cmd.keywords}
      onSelect={() => onSelect(cmd.id)}
      // Mirrors the EntityCommandItem fix: cmdk doesn't fire onSelect on
      // mobile taps unless the item was first keyboard-focused. Explicit
      // onClick makes pointer interaction work cross-platform.
      onClick={(e) => {
        e.preventDefault();
        onSelect(cmd.id);
      }}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
      style={{
        color: "var(--text-primary)",
      }}
      data-cmd-item
    >
      <span
        data-cmd-icon
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{
          backgroundColor: "var(--surface-2)",
          color: "var(--text-secondary)",
        }}
      >
        <CommandIcon name={cmd.icon} size={13} />
      </span>
      <span className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <span className="font-medium leading-tight">{cmd.label}</span>
        {cmd.description && (
          <span
            className="truncate text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {cmd.description}
          </span>
        )}
      </span>
      {cmd.shortcut && <ShortcutHint keys={cmd.shortcut} />}
    </Command.Item>
  );
}

// ---------------------------------------------------------------------------
// EntityCommandItem
// ---------------------------------------------------------------------------

const TYPE_ICON_MAP: Record<string, PhosphorIcon> = {
  note: FileText,
  personne: Users,
  contact: Users,
  organisation: Folder,
  ressource: BookOpen,
  journal: Calendar,
};

function EntityCommandItem({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: (entityId: string, typeId: string) => void;
}) {
  const Icon = TYPE_ICON_MAP[result.typeId.toLowerCase()] ?? FileText;
  const subtitle = result.excerpts[0] ?? result.filePath;
  // cmdk needs a unique stable value per item — entityId is guaranteed
  // unique. Filtering is disabled at the Command root, so the value here
  // is purely for selection / keyboard nav.
  return (
    <Command.Item
      value={`entity:${result.entityId}`}
      onSelect={() => onSelect(result.entityId, result.typeId)}
      // cmdk's onSelect fires on Enter and on synthetic click after the item
      // has been keyboard-focused — on mobile tap the item is never marked
      // `data-selected` first, so onSelect never runs. Adding an explicit
      // onClick makes the row react to taps and clicks alike.
      onClick={(e) => {
        e.preventDefault();
        onSelect(result.entityId, result.typeId);
      }}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
      style={{ color: "var(--text-primary)" }}
      data-cmd-item
    >
      <span
        data-cmd-icon
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{
          backgroundColor: "var(--surface-2)",
          color: "var(--text-secondary)",
        }}
      >
        <Icon size={13} />
      </span>
      <span className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <span className="truncate font-medium leading-tight">
          {result.title || "Sans titre"}
        </span>
        {subtitle && (
          <span
            className="truncate text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {subtitle.replace(/<\/?mark>/g, "")}
          </span>
        )}
      </span>
    </Command.Item>
  );
}
