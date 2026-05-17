/**
 * worker-protocol — message types exchanged between UI thread and vault worker.
 *
 * Request: { id, path, type, input }
 * Response: { id, ok: true, result } | { id, ok: false, error }
 *
 * Special bootstrap messages:
 *   INIT_VAULT  — sent once after folder picker with the FSA handle
 *   VAULT_READY — worker replies when init is complete
 *   VAULT_STATE — worker broadcasts current vault state
 */

export interface WorkerRequest {
  id: string;
  path: string;
  type: "query" | "mutation";
  input?: unknown;
}

export interface WorkerOkResponse {
  id: string;
  ok: true;
  result: unknown;
}

export interface WorkerErrResponse {
  id: string;
  ok: false;
  error: string;
}

export type WorkerResponse = WorkerOkResponse | WorkerErrResponse;

// Bootstrap messages (no id — fire-and-forget from/to worker)
export interface InitVaultMessage {
  type: "INIT_VAULT";
  handle: FileSystemDirectoryHandle;
}

/**
 * Force the worker to synchronously flush any pending DB writes.
 * Sent on navigation / page-hide so an in-flight debounced persist
 * doesn't get dropped before the next INIT_VAULT.
 *
 * Carries an `id` so the UI can await the resulting WorkerResponse.
 */
export interface FlushMessage {
  type: "FLUSH";
  id: string;
}

export interface VaultReadyMessage {
  type: "VAULT_READY";
  vaultId: string;
  vaultName: string;
  rootPath: string;
}

export interface VaultErrorMessage {
  type: "VAULT_ERROR";
  error: string;
}

export interface IndexProgressMessage {
  type: "INDEX_PROGRESS";
  indexed: number;
  total: number;
}

/**
 * Fired by PwaBootstrap when the Service Worker forwards a Periodic
 * Background Sync nudge. The worker runs an immediate engine tick + cron
 * catch-up so missed routines fire without waiting for the 60 s interval.
 */
export interface AutomationTickMessage {
  type: "AUTOMATION_TICK";
}

export type WorkerInboundMessage = WorkerRequest | InitVaultMessage | FlushMessage | AutomationTickMessage;
export type WorkerOutboundMessage = WorkerResponse | VaultReadyMessage | VaultErrorMessage | IndexProgressMessage;
