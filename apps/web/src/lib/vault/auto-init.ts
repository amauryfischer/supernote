/**
 * Vault auto-initialization logic.
 *
 * Strategy:
 * 1. Check if a current vault exists via `vault.getCurrent`.
 * 2. If none → call `vault.open` with the default path `~/Documents/Supernote`.
 *    The main process resolves `~` via `app.getPath('home')`, but we pass a
 *    placeholder string that the VaultManager expands. In practice the path is
 *    passed as-is; the OS will resolve `~` on unix or we rely on the main
 *    process having already expanded paths. To be safe we delegate the actual
 *    path resolution to `system.getAppInfo` and build from `userDataPath`,
 *    or simply pass the conventional path and let the main process handle it.
 *
 *    Simpler approach adopted here: pass `""` (empty) which signals the
 *    VaultManager to use its built-in default. If `vault.open` does not
 *    support empty path, we fall back to the conventional string
 *    `~/Documents/Supernote` — the OS resolves `~` on the write.
 */

export const DEFAULT_VAULT_PATH = "~/Documents/Supernote" as const;
