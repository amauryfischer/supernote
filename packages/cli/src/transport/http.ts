import type { TransportOutcome } from "./types.js";

export async function callHttp<T>(
  token: string,
  port: number,
  method: string,
  params: unknown,
): Promise<TransportOutcome<T>> {
  const url = `http://127.0.0.1:${port}/rpc/${method}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        transport: "http",
      };
    }

    const data = (await response.json()) as T;
    return { ok: true, data, transport: "http" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, transport: "http" };
  }
}
