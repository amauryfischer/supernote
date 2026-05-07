export type CommandGroup =
  | "navigation"
  | "creation"
  | "editing"
  | "view"
  | "tools"
  | "plugin";

export interface Command {
  id: string;
  label: string;
  description?: string;
  /** Lucide icon name, e.g. "file-text" */
  icon?: string;
  /** Keyboard shortcut hint, e.g. "mod+n" */
  shortcut?: string;
  group?: CommandGroup;
  /** Extra tokens for fuzzy search scoring */
  keywords?: string[];
  /** When false (or returns false), command is hidden from palette */
  when?: () => boolean;
  run: () => void | Promise<void>;
}

export interface CommandRegistry {
  register(cmd: Command): () => void;
  unregister(id: string): void;
  list(): Command[];
  search(query: string): Command[];
  execute(id: string): Promise<void>;
}
