/**
 * IndexedDB partagée avec le service worker (push mail, badge). Base **dédiée**
 * (`supernote-sw`), jamais celle des handles de coffre : un changement de
 * version ici ne doit jamais toucher au coffre.
 */

const DB_NAME = "supernote-sw";
const STORE = "kv";

export type SwKvKey = "gmailToken" | "mailHistoryId" | "badgeCount";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const swKvGet = <T>(key: SwKvKey) => run<T>("readonly", (s) => s.get(key));
export const swKvSet = async (key: SwKvKey, value: unknown) => void (await run("readwrite", (s) => s.put(value, key)));
export const swKvDelete = async (key: SwKvKey) => void (await run("readwrite", (s) => s.delete(key)));

export function setBadge(n: number): void {
  void swKvSet("badgeCount", n).catch(() => undefined);
  if (!("setAppBadge" in navigator)) return;
  void (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => undefined);
}
