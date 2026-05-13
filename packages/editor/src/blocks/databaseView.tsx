// Database view block — inline Coda/Notion-style database in a note.
//
// Renders a saved view (or an ad-hoc inline view) of a Base (EntityType) right
// inside the note flow. Editing a cell in this block propagates to every other
// open view of the same Base.
//
// Architecture note: this block lives in @supernote/editor (so it can be
// registered in supernoteSchema) but the actual data-fetching + grid
// component lives in the host app. The host injects a renderer via
// <DatabaseViewProvider> at mount time. The fallback rendering (no provider)
// is a stub placeholder so the block never crashes a standalone editor demo.

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";

// ── Renderer slot (filled by the host app) ────────────────────────────────

export interface DatabaseViewBlockProps {
  baseId: string;
  viewId: string;
}

export type DatabaseViewRenderer = (
  props: DatabaseViewBlockProps,
) => React.ReactNode;

const DatabaseViewRendererContext =
  React.createContext<DatabaseViewRenderer | null>(null);

export function DatabaseViewProvider({
  renderer,
  children,
}: {
  renderer: DatabaseViewRenderer;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <DatabaseViewRendererContext.Provider value={renderer}>
      {children}
    </DatabaseViewRendererContext.Provider>
  );
}

export function useDatabaseViewRenderer(): DatabaseViewRenderer | null {
  return React.useContext(DatabaseViewRendererContext);
}

// ── Block spec ─────────────────────────────────────────────────────────────

/**
 * BlockNote schema requires propSchema values to be primitives. We store
 * `baseId` (an EntityType id) and `viewId` (a saved view id) as strings.
 * Empty strings mean "not yet picked" and the block renders an empty-state
 * picker prompting the user to choose.
 */
export const databaseViewBlockSpec = createReactBlockSpec(
  {
    type: "databaseView" as const,
    propSchema: {
      baseId: { default: "" },
      viewId: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: ({ block }) => {
      const baseId = (block.props.baseId ?? "") as string;
      const viewId = (block.props.viewId ?? "") as string;
      const renderer = useDatabaseViewRenderer();

      return (
        <div
          className="sn-database-block"
          // Block is non-editable — the inner cells handle their own focus.
          contentEditable={false}
        >
          {!baseId ? (
            <DatabaseBlockEmptyState />
          ) : renderer ? (
            renderer({ baseId, viewId })
          ) : (
            <DatabaseBlockOfflineFallback baseId={baseId} viewId={viewId} />
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => {
      // Markdown export: emit a placeholder div the import side can detect
      // to round-trip back to a databaseView block. Keeping it minimal so
      // the markdown stays readable when the note is opened in a generic
      // editor.
      const baseId = (block.props.baseId ?? "") as string;
      const viewId = (block.props.viewId ?? "") as string;
      return (
        <div
          className="sn-database-block-export"
          data-base-id={baseId}
          data-view-id={viewId || undefined}
        >
          <p>
            Database view (base={baseId || "?"}
            {viewId ? `, view=${viewId}` : ""})
          </p>
        </div>
      );
    },
  },
);

// ── CustomEvent bridge (host → editor reconfigure) ────────────────────────
//
// The block render callback can't read the editor instance, so the host's
// picker UI publishes a CustomEvent that we listen for inside the editor.
// Pragmatic: the host doesn't need to plumb the editor ref everywhere.

const DB_PICK_EVENT = "supernote:database-block:pick";

export interface DatabaseBlockPickDetail {
  /** EntityType id (the Base) to display in the matching block. */
  nextBaseId: string;
  /** Optional saved view id to pin. Empty string = let the block pick a default. */
  nextViewId: string;
}

/** Dispatch a reconfigure request. Called by the host's BasePicker UI. */
export function requestDatabaseBlockReconfigure(
  detail: DatabaseBlockPickDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DB_PICK_EVENT, { detail }));
}

/**
 * Hook installed by SupernoteEditor — listens for reconfigure events and
 * updates the most-recently-inserted unconfigured `databaseView` block.
 * If no unconfigured block exists, falls back to the last `databaseView`
 * block in the document.
 *
 * `editor` is intentionally typed as `unknown` so the editor package
 * doesn't have to publicly type-export BlockNote's editor generic
 * parameters here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDatabaseBlockPickListener(editor: any): void {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!editor) return;
    const onPick = (event: Event) => {
      const detail = (event as CustomEvent<DatabaseBlockPickDetail>).detail;
      if (!detail) return;

      let unconfigured: { id: string } | null = null;
      let lastMatching: { id: string } | null = null;
      const visit = (block: { id: string; type: string; props: Record<string, unknown> }) => {
        if (block.type !== "databaseView") return;
        lastMatching = { id: block.id };
        if (!block.props["baseId"] && !unconfigured) {
          unconfigured = { id: block.id };
        }
      };
      if (typeof editor.forEachBlock === "function") {
        editor.forEachBlock(visit);
      } else if (Array.isArray(editor.document)) {
        for (const b of editor.document) visit(b);
      }
      const target = unconfigured ?? lastMatching;
      if (!target) return;
      // editor.updateBlock accepts either a block id or a block instance.
      editor.updateBlock(
        (target as { id: string }).id,
        { props: { baseId: detail.nextBaseId, viewId: detail.nextViewId } },
      );
    };
    window.addEventListener(DB_PICK_EVENT, onPick);
    return () => window.removeEventListener(DB_PICK_EVENT, onPick);
  }, [editor]);
}

// ── Inline subcomponents ─────────────────────────────────────────────────

function DatabaseBlockEmptyState(): React.JSX.Element {
  return (
    <div className="sn-database-block__empty">
      <p>Bloc Base non configuré</p>
      <span>Sélectionnez une Base à afficher.</span>
    </div>
  );
}

function DatabaseBlockOfflineFallback({
  baseId,
  viewId,
}: {
  baseId: string;
  viewId: string;
}): React.JSX.Element {
  return (
    <div className="sn-database-block__fallback">
      <p>Bloc Base (rendu indisponible)</p>
      <code>
        base={baseId}
        {viewId ? `, view=${viewId}` : ""}
      </code>
    </div>
  );
}
