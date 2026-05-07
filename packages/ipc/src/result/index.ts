import type { IpcError } from "../errors/index.js";

/**
 * Result<T, E> for IPC responses.
 *
 * TODO: Replace with @supernote/core/result once that package is a stable
 * dependency of this package. For now, we declare a minimal compatible type
 * so the renderer and main process can share typed responses without throwing
 * exceptions across the IPC bridge.
 *
 * Design note (spec §9): IPC = Result<T, E> typé (pas d'exceptions à travers le pont).
 */
export type IpcOk<T> = { readonly ok: true; readonly value: T };
export type IpcErr<E = IpcError> = { readonly ok: false; readonly error: E };
export type IpcResult<T, E = IpcError> = IpcOk<T> | IpcErr<E>;

export function ipcOk<T>(value: T): IpcOk<T> {
  return { ok: true, value };
}

export function ipcErr<E = IpcError>(error: E): IpcErr<E> {
  return { ok: false, error };
}

export function isIpcOk<T, E>(result: IpcResult<T, E>): result is IpcOk<T> {
  return result.ok;
}

export function isIpcErr<T, E>(result: IpcResult<T, E>): result is IpcErr<E> {
  return !result.ok;
}
