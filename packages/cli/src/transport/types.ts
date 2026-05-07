export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface TransportResult<T = unknown> {
  ok: true;
  data: T;
  transport: "socket" | "http" | "offline";
}

export interface TransportError {
  ok: false;
  error: string;
  transport: "socket" | "http" | "offline";
}

export type TransportOutcome<T = unknown> = TransportResult<T> | TransportError;
