import type { EmailThread } from "@/lib/gmail";
import type { OwnedShare } from "./shareApi";
import type { EmailSnapshot } from "./types";

const KEY = "supernote.share.email";

function readAll(): Record<string, OwnedShare> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, OwnedShare>) : {};
  } catch {
    return {};
  }
}

export function getEmailShare(accountId: string, threadId: string): OwnedShare | null {
  return readAll()[`${accountId}:${threadId}`] ?? null;
}

export function setEmailShare(accountId: string, threadId: string, share: OwnedShare | null): void {
  const all = readAll();
  if (share) all[`${accountId}:${threadId}`] = share;
  else delete all[`${accountId}:${threadId}`];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* stockage plein ou bloqué : le partage reste gérable tant que l'onglet vit */
  }
}

const address = (a: { name: string; email: string }) => (a.name ? `${a.name} <${a.email}>` : a.email);

const MAX_SNAPSHOT_MESSAGES = 200;

export function emailSnapshot(thread: EmailThread): EmailSnapshot {
  return {
    subject: thread.messages[0]?.subject ?? "",
    messages: thread.messages.slice(-MAX_SNAPSHOT_MESSAGES).map((m) => ({
      from: address(m.from),
      to: m.to.map(address).join(", "),
      date: m.date,
      bodyText: m.bodyText,
    })),
  };
}
