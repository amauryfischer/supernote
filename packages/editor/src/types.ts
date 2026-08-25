// Editor public types

import type { Block as BNBlock } from "@blocknote/core";
import type { GmailEmbedApi } from "./blocks/gmailMessage.js";

// Re-export Block for consumers
export type { Block } from "@blocknote/core";

/** Lightweight reference to a vault entity */
export interface EntityRef {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly icon?: string;
  readonly color?: string;
}

/** Callout variants matching Obsidian callout syntax */
export type CalloutVariant = "info" | "note" | "warning" | "danger" | "quote";

/** Resolver callbacks for entity search/create/get */
export interface EntityResolvers {
  /** Full-text search across entities, optionally filtered by typeId */
  searchEntities: (query: string, typeId?: string) => Promise<EntityRef[]>;
  /** Create a new entity of the given type with a name */
  createEntity?: (typeId: string, name: string) => Promise<EntityRef>;
  /** Fetch a single entity by id */
  getEntity?: (id: string) => Promise<EntityRef | null>;
  /**
   * Resolve a hover-preview for a wikilink target (entity NAME, not id).
   * Returns the display title and a short plain-text excerpt of the body,
   * or null when the target doesn't resolve. Enables the wikilink hover
   * card when provided.
   */
  previewEntity?: (
    name: string,
  ) => Promise<{ title: string; excerpt: string } | null>;
}

/**
 * Handle returned by the streaming-insert API. `append` adds raw text chunks
 * to a live block; `end` re-parses the accumulated text as markdown and
 * replaces the live block with the final rich blocks; `cancel` removes it.
 */
export interface StreamingInsertHandle {
  append: (chunk: string) => void;
  end: () => void;
  cancel: () => void;
}

/**
 * API impérative exposée au host une fois l'éditeur monté (2ᵉ argument de
 * `onEditorReady`). Complète la fonction d'insertion historique sans casser
 * les hosts existants qui n'utilisent que le 1ᵉʳ argument.
 */
export interface SupernoteEditorApi {
  /** Insère du markdown au caret — même fonction que le 1ᵉʳ argument. */
  insertAtCursor: (md: string) => void;
  /**
   * « Reprendre où j'en étais » : replace le caret à la fin du bloc donné,
   * scrolle le bloc dans le viewport s'il n'est pas visible et rejoue le
   * flash d'atterrissage (`.sn-block-flash`). Retourne `false` si le bloc
   * n'existe plus dans le document (le host garde alors son fallback scroll).
   */
  restoreCaret: (blockId: string) => boolean;
}

/**
 * Adaptateur fichiers du coffre. Branche le collage/dépôt de fichiers
 * (BlockNote `uploadFile`) et la résolution du chemin stocké dans le markdown
 * en URL affichable (BlockNote `resolveFileUrl`) — indispensable côté web où
 * les fichiers vivent derrière le worker (FSA/OPFS) et pas sur une URL http.
 */
export interface EditorFileAdapter {
  /** Persiste le fichier et retourne le chemin à écrire dans le markdown. */
  upload: (file: File) => Promise<string>;
  /** Traduit un chemin de coffre en URL chargeable (blob:). */
  resolveUrl: (url: string) => Promise<string>;
}

/** Props for the main SupernoteEditor component */
export interface SupernoteEditorProps {
  /** Client Ollama pour les actions IA inline. Si absent, actions désactivées. */
  aiClient?: import("@supernote/ai/ollama").OllamaClient;
  /** Résolveur de prompts (typiquement tRPC `ai.getPrompt`). */
  aiPromptResolver?: (id: import("@supernote/ai/actions").AIActionId) => Promise<string>;
  /** Titre courant de la note, transmis à l'IA pour contexte. */
  noteTitle?: string;
  /** Callback toast erreur. */
  onAIError?: (err: { code: string; message: string }) => void;
  /** Callback toast warning. */
  onAIWarning?: (msg: string) => void;
  /** Initial markdown content */
  initialMarkdown?: string;
  /** Called on every change with serialized markdown and raw blocks */
  onChange?: (markdown: string, blocks: BNBlock[]) => void;
  /** Called when user presses Ctrl/Cmd+S */
  onSave?: (markdown: string) => void;
  /** Placeholder text when editor is empty */
  placeholder?: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /**
   * Active les remplacements typographiques à la frappe (->, <-, =>, --,
   * ..., (c), (r), (tm), 1/2, 1/4, 3/4). Sans effet dans les blocs de code.
   * Défaut : `true`.
   */
  smartTypography?: boolean;
  /** Entity resolver callbacks (search, create, get) */
  resolvers?: EntityResolvers;
  /** @deprecated Use resolvers.searchEntities instead */
  resolveEntity?: (idOrName: string) => Promise<EntityRef | null>;
  /** @deprecated Use resolvers.searchEntities instead */
  searchEntities?: (query: string, types?: string[]) => Promise<EntityRef[]>;
  /** Search tags for autocomplete */
  searchTags?: (query: string) => Promise<string[]>;
  /** Additional CSS class for the wrapper element */
  className?: string;
  /** Called when the user triggers the "Demander à l'IA" slash command */
  onAskAi?: () => void;
  /**
   * Called once the editor is ready with an imperative insert function.
   * The function receives markdown text and inserts it at the current cursor
   * position as one paragraph block per double-newline-separated section.
   * The second argument exposes the richer imperative API (restoreCaret…) —
   * existing hosts that only read the first argument keep working.
   */
  onEditorReady?: (insert: (md: string) => void, api: SupernoteEditorApi) => void;
  /**
   * Notifié quand le bloc top-level contenant le caret change (`null` quand
   * la sélection sort de l'éditeur). Piggy-back sur le tracker
   * `selectionchange` existant — coût nul si non fourni.
   */
  onActiveBlockChange?: (blockId: string | null) => void;
  /**
   * Called once the editor is ready with a factory that starts a streaming
   * insertion at the cursor (AI responses arriving token by token). Each
   * call to the factory inserts a live block and returns a handle.
   */
  onStreamingInsertReady?: (begin: () => StreamingInsertHandle) => void;
  /**
   * Dim every block except the one holding the caret (typewriter focus).
   * Wired by the host to its focus mode.
   */
  dimInactiveBlocks?: boolean;
  /**
   * Renderer for inline database blocks. When provided, every `databaseView`
   * block in the document calls this renderer with its (baseId, viewId).
   * If absent, the block falls back to a stub placeholder.
   */
  renderDatabaseView?: (props: {
    baseId: string;
    viewId: string;
  }) => React.ReactNode;
  /** Renderer pour les formules inline/block. */
  renderFormula?: (props: {
    expression: string;
    outputKind?: string;
    onEdit?: () => void;
  }) => React.ReactNode;
  /**
   * Renderer pour les blocs embed/transclusion ![[Note]] (portail vivant).
   * Si absent, le bloc affiche un fallback statique.
   */
  renderEmbed?: (props: { target: string; alias?: string }) => React.ReactNode;
  /**
   * Renderer pour les blocs doodle (croquis Excalidraw inline). sceneData est
   * le JSON de la scène ("" si vierge) ; onChange persiste la nouvelle scène.
   * Si absent, le bloc affiche un fallback statique.
   */
  renderDoodle?: (props: { sceneData: string; onChange: (sceneData: string) => void }) => React.ReactNode;
  /**
   * Renderer pour les blocs Google Sheet. Si fourni, l'app décide l'affichage
   * (feuille privée lue via l'API Sheets → table, ou fallback iframe). Si
   * absent, le bloc affiche son iframe pubhtml self-contained.
   */
  renderGoogleSheet?: (props: { spreadsheetId: string; gid: string; url: string; onClear: () => void }) => React.ReactNode;
  /** API d'embed Gmail (Phase 2) : rendu d'un thread + picker d'email. */
  gmailEmbed?: GmailEmbedApi;
  /**
   * Adaptateur fichiers (upload + résolution d'URL). Sans lui, BlockNote
   * refuse le collage/dépôt de fichiers et les blocs image restent cassés.
   * Lu au montage uniquement — passer un objet stable.
   */
  files?: EditorFileAdapter;
  /** Map résolue combo->actionId pour les raccourcis éditeur. Défaut : registre. */
  getKeymapBindings?: () => Record<string, string>;
}
