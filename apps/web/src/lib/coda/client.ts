/**
 * Browser-side Coda client. Talks ONLY to the same-origin proxy (`/api/coda/*`,
 * see `apps/web/coda-backend.mjs`) — never to coda.io directly, so the token
 * stays server-side and CORS is a non-issue. All calls return a {@link Result};
 * nothing throws.
 */

import { ok, err, type Result } from "@supernote/core/result";
import type {
  CodaDoc,
  CodaTable,
  CodaColumn,
  CodaRow,
  CodaListResponse,
} from "./types";

const API = "/api/coda";

async function getJson<T>(path: string): Promise<Result<T, Error>> {
  try {
    const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" } });
    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      return err(
        new Error(`Limite de débit Coda atteinte${retry ? ` — réessayer dans ${retry}s` : ""}`),
      );
    }
    if (res.status === 404) {
      // The proxy 404s both unknown routes and a disabled connector.
      return err(new Error("Connecteur Coda indisponible (CODA_API_TOKEN absent ?)"));
    }
    if (!res.ok) return err(new Error(`Coda HTTP ${res.status}`));
    return ok((await res.json()) as T);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/** Whether the server has the Coda connector wired (token present). */
export async function codaStatus(): Promise<boolean> {
  const r = await getJson<{ enabled: boolean }>("/status");
  return r.ok && r.value.enabled === true;
}

/** Walk every page of a Coda list endpoint, accumulating items. */
async function listAll<T>(basePath: string, extra?: string): Promise<Result<T[], Error>> {
  const items: T[] = [];
  let pageToken: string | undefined;
  // Hard guard against a pathological pagination loop.
  for (let guard = 0; guard < 5000; guard++) {
    const q = new URLSearchParams(extra ?? "");
    q.set("limit", "200");
    if (pageToken) q.set("pageToken", pageToken);
    const r = await getJson<CodaListResponse<T>>(`${basePath}?${q.toString()}`);
    if (!r.ok) return r;
    items.push(...(r.value.items ?? []));
    if (!r.value.nextPageToken) return ok(items);
    pageToken = r.value.nextPageToken;
  }
  return ok(items);
}

export function listDocs(): Promise<Result<CodaDoc[], Error>> {
  return listAll<CodaDoc>("/docs");
}

export function listTables(docId: string): Promise<Result<CodaTable[], Error>> {
  return listAll<CodaTable>(`/docs/${encodeURIComponent(docId)}/tables`);
}

export function listColumns(
  docId: string,
  tableId: string,
): Promise<Result<CodaColumn[], Error>> {
  return listAll<CodaColumn>(
    `/docs/${encodeURIComponent(docId)}/tables/${encodeURIComponent(tableId)}/columns`,
  );
}

export function listRows(
  docId: string,
  tableId: string,
): Promise<Result<CodaRow[], Error>> {
  // Rich values so relation/lookup cells carry rowId references.
  return listAll<CodaRow>(
    `/docs/${encodeURIComponent(docId)}/tables/${encodeURIComponent(tableId)}/rows`,
    "valueFormat=rich&useColumnNames=false",
  );
}
