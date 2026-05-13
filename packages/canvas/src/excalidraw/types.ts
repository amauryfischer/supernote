// ============================================================
// Excalidraw v2 file format — subset used by Supernote.
// Reference: https://docs.excalidraw.com/docs/codebase/json-schema
//
// We deliberately do NOT depend on @excalidraw/excalidraw's internal
// types here: this module must be importable from the vault-worker
// (no `window`), and Excalidraw's types pull in DOM dependencies.
// ============================================================

export type ExcalidrawElementType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "arrow"
  | "line"
  | "freedraw"
  | "image"
  | string;

/**
 * Excalidraw element. We treat it as an opaque blob with a few well-known
 * fields. Round-tripping unknown properties is essential — external edits
 * on excalidraw.com may introduce fields we don't know about, and they
 * must survive a load/save cycle on the Supernote side.
 */
export interface ExcalidrawElement {
  readonly id: string;
  readonly type: ExcalidrawElementType;
  readonly customData?: Record<string, unknown>;
  readonly link?: string | null;
  readonly [key: string]: unknown;
}

export interface ExcalidrawAppState {
  readonly viewBackgroundColor?: string;
  readonly gridSize?: number | null;
  readonly [key: string]: unknown;
}

export interface ExcalidrawFile {
  readonly type: "excalidraw";
  readonly version: 2;
  readonly source: string;
  readonly elements: readonly ExcalidrawElement[];
  readonly appState?: ExcalidrawAppState;
  readonly files?: Record<string, unknown>;
}

export const EXCALIDRAW_SOURCE = "supernote";
