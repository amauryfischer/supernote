"use client";

/**
 * NoteCanvasView — the "Canvas" view of a note.
 *
 * Background: the canvas is a *view* of a note, not a separate entity.
 * Every note has a `body` (markdown, the Note view) and an optional
 * `fields.canvas` JSON payload (the Canvas view).
 *
 * First-open seeding: when `fields.canvas` is empty/null/undefined we seed
 * the scene with a single entity-ref rectangle representing the current
 * note, so users land on a starting block they can drag and connect rather
 * than a blank canvas. The seed is NOT persisted until the user actually
 * modifies the canvas — see `userHasModifiedRef` below — so the /canvas
 * gallery only lists notes the user has genuinely laid out.
 *
 * Persistence: the serialized CanvasDocument is written back onto
 * `entity.fields.canvas` via `entities.update`, debounced 1s so dragging
 * a node 60 times/second doesn't flood the worker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type {
  CanvasDocument,
  CanvasExcalidrawElement,
  EntityRef as CanvasEntityRef,
} from "@supernote/canvas";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import type { Note } from "./fixtures";
import { entityToNote } from "./adapters";
import { EntityLinkPicker } from "./EntityLinkPicker";

/**
 * Map an entity's typeName onto the correct detail page.
 * The fallback to /notes/{id} works because every entity
 * has a notes-style detail page in the current routing layout.
 */
function entityHref(entityId: string, entityType: string): string {
  const t = entityType.toLowerCase();
  if (t === "contact" || t === "personne") return `/contacts/${entityId}`;
  if (t === "note") return `/notes/${entityId}`;
  // Liens "Lier une base" : pointent vers la vue grille de la Base.
  if (t === "base") return `/bases/${entityId}`;
  return `/notes/${entityId}`;
}

// Excalidraw + React Flow are browser-only; the canvas package depends on
// `window` and would crash during Next.js's prerender pass without this.
const SupernoteCanvas = dynamic(
  () => import("@supernote/canvas").then((m) => m.SupernoteCanvas),
  { ssr: false, loading: () => <CanvasSpinner /> },
);

interface NoteCanvasViewProps {
  note: Note;
}

function entityDisplayName(entity: {
  fields: Record<string, unknown>;
  filePath: string;
}): string {
  const name =
    entity.fields["name"] ?? entity.fields["titre"] ?? entity.fields["title"];
  if (typeof name === "string" && name.length > 0) return name;
  return (
    entity.filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? entity.filePath
  );
}

/**
 * Build the default canvas document for a note that has never had its
 * canvas view opened. We seed a single Excalidraw rectangle that REPRESENTS
 * the current note (an "entity-ref" element identical in shape to one the
 * user would create via "+ Lier une entité"), so the canvas opens with the
 * note itself as the first block — ready to be linked to others.
 *
 * The element MUST mirror DrawLayer's `addEntityRef` shape (customData kind
 * + supernote-entity://… link) so click-to-navigate, persistence, and the
 * link-icon overlay work uniformly with user-added refs. Excalidraw's
 * `restoreElements` fills in the remaining defaults (seed/version/etc.) on
 * mount, so a minimal skeleton is enough.
 *
 * IMPORTANT: this seed must NOT be auto-saved until the user actually
 * modifies the canvas — otherwise every opened-but-untouched note would
 * appear in the /canvas gallery. The save-skip is enforced by a mount
 * grace window in `handleChange` below.
 */
function defaultCanvasFromNote(note: Note): CanvasDocument {
  const entityName = note.title || "Sans titre";
  const seedId = `entity-seed-${note.id}`;
  const seedTextId = `entity-seed-text-${note.id}`;
  // Position centered around (0,0): the canvas opens scrollToContent so the
  // user lands on the seed regardless of viewport size.
  const x = -150;
  const y = -40;
  const width = 300;
  const height = 80;
  const link = `supernote-entity://${encodeURIComponent(note.id)}?type=note`;
  const seed: CanvasExcalidrawElement = {
    id: seedId,
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#7c3aed",
    backgroundColor: "#ede9fe",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    // Bind a text child so Excalidraw renders the note title centered inside
    // the rectangle. Without this the seed shows as an empty purple block.
    boundElements: [{ id: seedTextId, type: "text" }],
    updated: 1,
    locked: false,
    link,
    customData: {
      kind: "entity-ref",
      entityId: note.id,
      entityName,
      entityType: "note",
    },
  };
  // Bound-text element. Excalidraw's restoreElements fills the leftover
  // defaults (seed/version/baseline/etc.); we provide just enough to drive
  // the visible label.
  const seedText: CanvasExcalidrawElement = {
    id: seedTextId,
    type: "text",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1a1a2e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    boundElements: null,
    updated: 1,
    locked: false,
    text: entityName,
    fontSize: 18,
    fontFamily: 2, // Helvetica — most legible at small sizes
    textAlign: "center",
    verticalAlign: "middle",
    containerId: seedId,
    originalText: entityName,
    lineHeight: 1.25,
  };
  return {
    nodes: [],
    edges: [],
    excalidrawElements: [seed, seedText],
  };
}

/**
 * Tolerant parser: a corrupt JSON payload (or an old-format doc that lacks
 * `nodes`/`edges`) shouldn't block the canvas — fall back to the default
 * doc so the user can keep working and overwrite it.
 *
 * "Empty" cases all yield the seeded default (single entity-ref representing
 * the current note): missing/empty raw, parse error, malformed structure,
 * or a structurally empty doc (no nodes AND no excalidrawElements). The
 * seeded version is NOT auto-persisted — see the mount-grace check in
 * `handleChange` — so this won't pollute the /canvas gallery for unopened
 * notes.
 */
function parseCanvasField(raw: unknown, note: Note): CanvasDocument {
  if (typeof raw !== "string" || raw.length === 0) {
    return defaultCanvasFromNote(note);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasDocument>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return defaultCanvasFromNote(note);
    }
    const ex = Array.isArray(parsed.excalidrawElements)
      ? parsed.excalidrawElements
      : [];
    // Treat a doc that round-tripped to "no nodes and no excalidraw elements"
    // the same as an empty canvas — historically this could happen with
    // pre-seed canvases that lost their body-text default on a save round-trip.
    if (parsed.nodes.length === 0 && ex.length === 0) {
      return defaultCanvasFromNote(note);
    }
    return {
      nodes: parsed.nodes,
      edges: parsed.edges,
      ...(ex.length > 0 ? { excalidrawElements: ex } : {}),
      ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
    };
  } catch {
    return defaultCanvasFromNote(note);
  }
}

export function NoteCanvasView({ note }: NoteCanvasViewProps) {
  // Hydration race guard: when a note references a `.excalidraw` sibling
  // (`canvasFile` set) but the worker hasn't injected `fields.canvas` yet
  // (entitiesGet hydrates it asynchronously), mounting the canvas with a
  // SEEDED initial doc would let the very first user edit overwrite the
  // real `.excalidraw` content with the seed. Defer the actual mount until
  // hydration lands.
  const expectsHydration =
    typeof note.fields?.["canvasFile"] === "string" &&
    typeof note.fields["canvas"] !== "string";
  if (expectsHydration) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Chargement du canvas…
      </div>
    );
  }
  // Fetch the FRESH canvas blob from the worker before mounting the inner
  // component. The TanStack Query cache backing `note` can serve a stale
  // snapshot (default `staleTime: 30s`) — and the inner component pins its
  // `initialDocument` via `useMemo([note.id])`, so whatever the cache hands
  // us at FIRST mount becomes the canonical scene FOREVER. Mounting with a
  // stale snapshot + the user's first edit produces `staleScene + newElement`,
  // overwriting every disk change that landed in between. Round-tripping
  // through the worker on every mount of the canvas view guarantees we start
  // from disk truth, not whatever the cache happened to remember.
  return <NoteCanvasViewBoot note={note} />;
}

/**
 * Round-trip the note id through the worker once per mount so the inner
 * component sees the disk-truth canvas blob, not the (potentially stale)
 * TanStack Query cache. Re-fetches whenever the user switches notes.
 *
 * We deliberately don't gate on the existing `entities.get.useQuery` —
 * that query's `placeholderData: (prev) => prev` keeps surfacing the stale
 * blob during the refetch, and the inner component would still mount with
 * the placeholder before fresh data lands.
 */
function NoteCanvasViewBoot({ note }: NoteCanvasViewProps) {
  const utils = trpc.useUtils();
  const [freshNote, setFreshNote] = useState<Note | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Force a worker hit (skip the React Query cache entirely) so the
    // initialDocument is built from disk-truth even if the cache is stale.
    void utils.entities.get
      .fetch({ id: note.id }, { staleTime: 0 })
      .then((fresh) => {
        if (cancelled) return;
        setFreshNote(entityToNote(fresh));
      })
      .catch(() => {
        if (cancelled) return;
        // Worker call failed — fall back to the cached snapshot so the
        // canvas at least opens. The user can manually retry by switching
        // views; we don't want to leave them stranded on a spinner.
        setFreshNote(note);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);
  if (!freshNote) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Chargement du canvas…
      </div>
    );
  }
  return <NoteCanvasViewInner note={freshNote} />;
}

function NoteCanvasViewInner({ note }: NoteCanvasViewProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation();
  // `updateMutation` is a NEW object on every render (TanStack mutation state
  // ticks between idle/pending/success). The canvas `onChange` callback used
  // to capture it via useCallback deps, which made the callback identity
  // change DURING the save itself — SupernoteCanvas re-fired onChange from
  // its `[onChange]` useEffect, reset the 1-second debounce, and the "saving"
  // indicator never resolved. We pin the mutation in a ref so handleChange
  // stays referentially stable across renders.
  const updateMutationRef = useRef(updateMutation);
  useEffect(() => {
    updateMutationRef.current = updateMutation;
  }, [updateMutation]);
  const utilsRef = useRef(utils);
  useEffect(() => {
    utilsRef.current = utils;
  }, [utils]);

  // Initial doc: we intentionally key off note.id only. If we re-derived
  // every render and the parent re-fetched the entity, the canvas store
  // would reset and clobber unsaved positions.
  const initialDocument = useMemo(() => {
    const stored = note.fields?.["canvas"];
    return parseCanvasField(stored, note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Whether the note already had persisted canvas data at mount. When false,
  // we treat the canvas as "seeded only" and SUPPRESS auto-saves until the
  // user actually changes something — otherwise opening the canvas view of
  // an empty note would persist the seed and inflate the /canvas gallery.
  const hadStoredCanvas = useMemo(() => {
    const stored = note.fields?.["canvas"];
    if (typeof stored !== "string" || stored.length === 0) return false;
    try {
      const parsed = JSON.parse(stored) as Partial<CanvasDocument>;
      const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
      const ex = Array.isArray(parsed.excalidrawElements)
        ? parsed.excalidrawElements
        : [];
      return nodes.length > 0 || ex.length > 0;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Pre-filter the picker's autocomplete to a single entity type (e.g.
  // "personne", "note") when the user clicked a typed "Lier ..." toolbar
  // button. `undefined` = the legacy "any type" flow.
  const [pickerTypeFilter, setPickerTypeFilter] = useState<string | undefined>(
    undefined,
  );
  const addEntityNodeRef = useRef<((entityId: string) => void) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSerializedRef = useRef<string>("");
  // Client-side single-flight. While a save is in flight we don't fire a
  // second mutateAsync — we stash the latest serialized payload in `pendingRef`
  // and re-fire ONCE after the current save resolves. Without this, rapid
  // edits (multiple shapes drawn in quick succession) queued multiple parallel
  // mutateAsync calls. Even though the worker now serializes per-entity (so
  // the disk content is correct), the redundant in-flight saves kept the
  // "Enregistrement…" indicator pinned and racked up extra FSA writes.
  const inFlightRef = useRef<boolean>(false);
  const pendingSerializedRef = useRef<string | null>(null);
  // Latches to true on the first onChange that represents a real user
  // modification. Until then we don't persist anything — opening the canvas
  // view of an empty note must NOT mark it "has data" (would inflate the
  // /canvas gallery). Pre-set when there's already stored canvas data so we
  // resume the normal save path immediately for existing canvases.
  const userHasModifiedRef = useRef<boolean>(hadStoredCanvas);
  // The seeded doc carries exactly one excalidraw element (the entity-ref
  // for the current note). We use this id to recognise "still just the
  // seed" payloads even after Excalidraw normalises the element with
  // seed/version/etc. fields.
  const seedElementIdRef = useRef<string | null>(
    !hadStoredCanvas
      ? (initialDocument.excalidrawElements?.[0]?.id ?? null)
      : null,
  );

  // 1s debounce — Excalidraw fires onChange ~60 ×/sec while dragging.
  const handleChange = useCallback(
    (docArg: CanvasDocument) => {
      const doc = docArg;
      const serialized = JSON.stringify(doc);
      // First-modification gate: until the user actually changes something,
      // SupernoteCanvas may emit several onChange events as Excalidraw
      // settles (mount restore, default-fill of seed/version, text bounds…).
      // We recognise "still just the seed" via the lone entity-ref element
      // id and suppress the save until something else appears or the seed
      // is moved/resized in a way the user can see (we use position +
      // dimension drift to detect intentional moves).
      if (!userHasModifiedRef.current) {
        const seedId = seedElementIdRef.current;
        const ex = doc.excalidrawElements ?? [];
        // The seed is a rectangle + a bound text element (so the block
        // shows the note title). "Still seed-only" → at most these two
        // elements, all carrying our `entity-seed-*` id prefix, with the
        // rectangle's customData still flagged entity-ref. We deliberately
        // skip the position/size equality check Excalidraw can normalise
        // those fields slightly during restore (font metric reflow on
        // bound-text containers, etc.) and we'd otherwise persist the seed
        // by accident, inflating the /canvas gallery.
        const rect = ex.find((e) => e.id === seedId);
        const allFromSeed =
          ex.length > 0 &&
          ex.length <= 2 &&
          ex.every(
            (e) =>
              typeof e.id === "string" && e.id.startsWith("entity-seed-"),
          );
        const isSeedOnly =
          seedId !== null &&
          (doc.nodes?.length ?? 0) === 0 &&
          allFromSeed &&
          rect !== undefined &&
          (rect["customData"] as { kind?: string } | undefined)?.kind ===
            "entity-ref";
        if (isSeedOnly) {
          lastSerializedRef.current = serialized;
          return;
        }
        // Real user modification (added an element, moved the seed, etc.) —
        // promote to "dirty" and fall through to the normal save path.
        userHasModifiedRef.current = true;
      }

      // Degenerate-element filter REMOVED. The previous heuristic stripped any
      // shape whose width AND height were both 0/undefined, intended to drop
      // ghost rectangles from a tap-without-drag. In practice it interacted
      // badly with the real shape lifecycle: Excalidraw fires `onChange`
      // intermediately during pointer-down with w=h=0, and our filter would
      // strip the shape before its dimensions settled. Even if a later
      // onChange replaced the cleaned snapshot, certain refresh / re-render
      // orderings could leave the persisted payload missing the shape the
      // user just drew. Trust Excalidraw to keep its scene consistent — its
      // own restore pipeline drops degenerate elements at the boundary.

      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus((prev) => (prev === "saving" ? prev : "saving"));
      {
        const ex = doc.excalidrawElements ?? [];
        const summary = ex.slice(-3).map((e) => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          id: (e as any).id?.slice(0, 8),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: (e as any).type,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isDeleted: (e as any).isDeleted,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          w: (e as any).width,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          h: (e as any).height,
        }));
        console.info(
          `[NoteCanvasView] handleChange queued — elements=${ex.length} last3=${JSON.stringify(summary)}`,
        );
      }
      debounceRef.current = setTimeout(() => {
        if (serialized === lastSerializedRef.current) {
          // No actual content change (probably a no-op re-render) — clear
          // the optimistic "Saving…" indicator so it doesn't get stuck.
          setSaveStatus("idle");
          return;
        }
        if (inFlightRef.current) {
          // A save is already mid-flight for this entity. Stash the latest
          // payload so it runs ONCE after the in-flight save completes —
          // skipping any intermediate snapshots the user has since super-
          // seded. Without this, rapid drawing piled up parallel mutate-
          // Async calls that all targeted the same entity, leaving the
          // "Enregistrement…" indicator pinned until every redundant save
          // resolved.
          pendingSerializedRef.current = serialized;
          return;
        }
        void runSave(serialized);
      }, 1000);

      async function runSave(payload: string): Promise<void> {
        inFlightRef.current = true;
        try {
          let exCount = -1;
          try {
            exCount = (JSON.parse(payload) as { excalidrawElements?: unknown[] })
              .excalidrawElements?.length ?? 0;
          } catch {
            // best-effort logging — fall through with exCount=-1
          }
          console.info(
            `[NoteCanvasView] save fire — exCount=${exCount} len=${payload.length} id=${note.id}`,
          );
          await updateMutationRef.current.mutateAsync({
            id: note.id,
            fields: { canvas: payload },
          });
          lastSerializedRef.current = payload;
          setSaveStatus("saved");
          console.info(`[NoteCanvasView] save complete id=${note.id}`);
          void utilsRef.current.entities.get.invalidate({ id: note.id });
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch (err) {
          console.error("[NoteCanvasView] save failed", err);
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 3000);
        } finally {
          inFlightRef.current = false;
          // Drain the queued payload, if any. We only ever keep the LATEST
          // queued snapshot (pendingSerializedRef is a single slot), so this
          // recurses at most once per intervening user edit.
          const queued = pendingSerializedRef.current;
          pendingSerializedRef.current = null;
          if (queued && queued !== lastSerializedRef.current) {
            await runSave(queued);
          }
        }
      }
    },
    // Deliberately empty so handleChange is referentially stable. We read
    // the mutation/utils through refs (updated by the effects above) — the
    // alternative (depending on `updateMutation`) creates a feedback loop
    // because SupernoteCanvas's `useEffect(..., [onChange])` re-fires
    // whenever this callback's identity changes, resetting the debounce
    // mid-save and locking the "Enregistrement…" indicator forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id],
  );

  // Flush pending save on unmount or note switch — otherwise the very last
  // edit before navigating away is lost. We also reset the modification
  // gate when the note id changes so the new note re-runs the seed-skip
  // logic (otherwise the previous note's "dirty" flag would leak through).
  useEffect(() => {
    userHasModifiedRef.current = hadStoredCanvas;
    seedElementIdRef.current = !hadStoredCanvas
      ? (initialDocument.excalidrawElements?.[0]?.id ?? null)
      : null;
    // Pre-stash the canonical mount payload so the FIRST onChange fired by
    // SupernoteCanvas's mount-effect (which carries the just-loaded scene,
    // not a user edit) matches via the dedup check and SKIPS the save.
    // Without this, every canvas mount triggered a redundant write of the
    // already-on-disk data and — worse — could race with an in-flight user
    // edit fired in the same tick, persisting the pre-edit snapshot last.
    // The shape must mirror SupernoteCanvas's own spread:
    //   `{ ...storeDoc, excalidrawElements: stateElements }`
    // where storeDoc = `{ ...initialData, nodes: [], edges: [], excalidrawElements }`.
    lastSerializedRef.current = JSON.stringify({
      ...initialDocument,
      nodes: [],
      edges: [],
      excalidrawElements: initialDocument.excalidrawElements ?? [],
    });
    pendingSerializedRef.current = null;
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [note.id, hadStoredCanvas, initialDocument]);

  // Resolver used by EntityCardNode to render real entity data on the canvas.
  // Tente d'abord l'entité ; si introuvable, tente la résolution comme Base
  // (schema/EntityType) pour les refs créées via le bouton "Lier une base".
  const resolveEntity = useCallback(
    async (id: string): Promise<CanvasEntityRef | null> => {
      try {
        const e = await utils.entities.get.fetch({ id });
        return {
          id: e.id,
          typeId: e.typeId,
          typeName: e.typeName,
          name: entityDisplayName(e),
          fields: e.fields,
        };
      } catch {
        try {
          const s = await utils.schemas.get.fetch({ id });
          return {
            id: s.id,
            typeId: "base",
            typeName: "base",
            name: s.plural || s.name,
            fields: {},
          };
        } catch {
          return null;
        }
      }
    },
    [utils],
  );

  const handleLinkEntity = useCallback(
    (addEntityNode: (entityId: string) => void, typeFilter?: string) => {
      addEntityNodeRef.current = addEntityNode;
      setPickerTypeFilter(typeFilter);
      setPickerOpen(true);
    },
    [],
  );

  // Click-to-navigate from an Excalidraw entity-ref element. The entityType
  // comes either from the element's customData or the URL query string we
  // baked into the link, so this is purely a routing decision.
  const handleEntityNavigate = useCallback(
    (entityId: string, entityType: string) => {
      router.push(entityHref(entityId, entityType));
    },
    [router],
  );

  const handlePickerSelect = useCallback(
    async (entityId: string) => {
      addEntityNodeRef.current?.(entityId);
      setPickerOpen(false);
    },
    [],
  );

  const handlePickerClose = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const searchEntities = useCallback(
    async (
      query: string,
      typeFilter?: string,
    ): Promise<
      Array<{ id: string; name: string; typeId: string; typeName: string }>
    > => {
      // Branche dédiée pour "Lier une base" : on cherche dans les EntityTypes
      // (schemas) au lieu des instances d'entités, parce qu'une Base = un
      // schéma, pas une row.
      if (typeFilter === "base") {
        try {
          const trimmed = query.trim();
          const types = await trpcVanillaClient.schemas.list.query({
            search: trimmed.length > 0 ? trimmed : undefined,
          });
          return types.slice(0, 20).map((t) => ({
            id: t.id,
            name: t.plural || t.name,
            typeId: "base",
            typeName: "base",
          }));
        } catch {
          return [];
        }
      }
      try {
        // The IPC schema requires `query.min(1)`. When the user opens the
        // picker via a typed toolbar button and hasn't typed anything yet we
        // still want to show the most-recent entities of that type — pass a
        // single-space placeholder so the worker takes its empty-query
        // branch (it trims and treats this as "no query, just typeId").
        const trimmed = query.trim();
        const res = await trpcVanillaClient.entities.search.query({
          query: trimmed.length > 0 ? trimmed : " ",
          ...(typeFilter ? { typeId: typeFilter } : {}),
          limit: 10,
        });
        return res.items.map((e) => ({
          id: e.id,
          name: entityDisplayName(e),
          typeId: e.typeId,
          typeName: e.typeName,
        }));
      } catch {
        return [];
      }
    },
    [],
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Save indicator — top-right, above the canvas chrome */}
      <div
        className="pointer-events-none absolute right-4 top-4 z-10 rounded-md px-2 py-1 text-xs"
        style={{
          backgroundColor: "var(--surface-1, rgba(255,255,255,0.85))",
          color: "var(--text-muted)",
          opacity: saveStatus === "idle" ? 0 : 1,
          transition: "opacity 200ms",
        }}
      >
        {saveStatus === "saving" && "Enregistrement…"}
        {saveStatus === "saved" && "Enregistré"}
        {saveStatus === "error" && "Erreur d'enregistrement"}
      </div>

      <div className="relative flex-1 overflow-hidden">
        <SupernoteCanvas
          initialData={initialDocument}
          onChange={handleChange}
          resolveEntity={resolveEntity}
          onLinkEntity={handleLinkEntity}
          onEntityNavigate={handleEntityNavigate}
          readOnly={false}
        />
      </div>

      {pickerOpen && (
        <EntityLinkPicker
          search={searchEntities}
          typeFilter={pickerTypeFilter}
          onSelect={handlePickerSelect}
          onClose={handlePickerClose}
        />
      )}
    </div>
  );
}

function CanvasSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: "var(--accent)" }}
      />
    </div>
  );
}
