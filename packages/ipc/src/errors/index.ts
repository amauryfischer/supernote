import { TRPCError } from "@trpc/server";

/** Discriminated union of all typed IPC error codes */
export type IpcErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "INTERNAL"
  | "NOT_IMPLEMENTED"
  | "VAULT_NOT_OPEN"
  | "SCHEMA_VIOLATION"
  | "FS_ERROR"
  | "GIT_ERROR"
  | "SEARCH_ERROR"
  | "AUTOMATION_ERROR";

export interface IpcErrorPayload {
  readonly code: IpcErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export type IpcError =
  | { readonly code: "NOT_FOUND"; readonly message: string; readonly details?: unknown }
  | { readonly code: "CONFLICT"; readonly message: string; readonly details?: unknown }
  | { readonly code: "VALIDATION"; readonly message: string; readonly details?: unknown }
  | { readonly code: "UNAUTHORIZED"; readonly message: string; readonly details?: unknown }
  | { readonly code: "INTERNAL"; readonly message: string; readonly details?: unknown }
  | { readonly code: "NOT_IMPLEMENTED"; readonly message: string; readonly details?: unknown }
  | { readonly code: "VAULT_NOT_OPEN"; readonly message: string; readonly details?: unknown }
  | { readonly code: "SCHEMA_VIOLATION"; readonly message: string; readonly details?: unknown }
  | { readonly code: "FS_ERROR"; readonly message: string; readonly details?: unknown }
  | { readonly code: "GIT_ERROR"; readonly message: string; readonly details?: unknown }
  | { readonly code: "SEARCH_ERROR"; readonly message: string; readonly details?: unknown }
  | { readonly code: "AUTOMATION_ERROR"; readonly message: string; readonly details?: unknown };

/** Maps IpcErrorCode to tRPC TRPC error code */
const IPC_TO_TRPC_CODE: Record<IpcErrorCode, TRPCError["code"]> = {
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  INTERNAL: "INTERNAL_SERVER_ERROR",
  NOT_IMPLEMENTED: "METHOD_NOT_SUPPORTED",
  VAULT_NOT_OPEN: "PRECONDITION_FAILED",
  SCHEMA_VIOLATION: "BAD_REQUEST",
  FS_ERROR: "INTERNAL_SERVER_ERROR",
  GIT_ERROR: "INTERNAL_SERVER_ERROR",
  SEARCH_ERROR: "INTERNAL_SERVER_ERROR",
  AUTOMATION_ERROR: "INTERNAL_SERVER_ERROR",
};

export function toTRPCError(error: IpcError): TRPCError {
  return new TRPCError({
    code: IPC_TO_TRPC_CODE[error.code],
    message: error.message,
    cause: error.details instanceof Error ? error.details : undefined,
  });
}

export function notImplemented(procedure: string): TRPCError {
  return new TRPCError({
    code: "METHOD_NOT_SUPPORTED",
    message: `${procedure} is not yet implemented`,
  });
}

export function ipcError(code: IpcErrorCode, message: string, details?: unknown): IpcError {
  return { code, message, details } as IpcError;
}
