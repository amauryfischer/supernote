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
  const router = useRouter();
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation();

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
    (doc: CanvasDocument) => {
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

      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus((prev) => (prev === "saving" ? prev : "saving"));
      debounceRef.current = setTimeout(async () => {
        if (serialized === lastSerializedRef.current) {
          // No actual content change (probably a no-op re-render) — clear
          // the optimistic "Saving…" indicator so it doesn't get stuck.
          setSaveStatus("idle");
          return;
        }
        try {
          await updateMutation.mutateAsync({
            id: note.id,
            fields: { canvas: serialized },
          });
          lastSerializedRef.current = serialized;
          setSaveStatus("saved");
          void utils.entities.get.invalidate({ id: note.id });
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch (err) {
          console.error("[NoteCanvasView] save failed", err);
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 3000);
        }
      }, 1000);
    },
    [note.id, updateMutation, utils],
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
    lastSerializedRef.current = "";
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [note.id, hadStoredCanvas, initialDocument]);

  // Resolver used by EntityCardNode to render real entity data on the canvas.
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
        return null;
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
