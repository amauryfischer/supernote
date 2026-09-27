import { googleRequest } from "@/lib/google-api";
import { GMAIL_MODIFY_SCOPE } from "@/lib/gmail";
import { hasValidToken, requestAccessToken, requestOfflineCode } from "@/lib/google-drive";
import { loadOnlineSyncConfig, type OnlineSyncConfig } from "@/lib/online-sync/config-storage";
import { fetchPushConfig, pushAvailability } from "@/lib/push/push-client";

const RENEWED_KEY = "supernote.mailWatch.renewedAt";
const GRANTED_KEY = "supernote.mailGrant.email";
const GRANT_PROMPT_KEY = "supernote.mailGrant.promptDismissedUntil";
const GRANT_PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60_000;
// Gmail fait expirer un watch au bout de 7 jours.
const RENEW_EVERY_MS = 24 * 60 * 60_000;

export async function renewMailWatch(clientId: string, config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  if (!clientId || pushAvailability(config) !== "ok" || Notification.permission !== "granted") return;
  // Jamais d'acquisition de jeton hors geste : GIS ouvrirait une popup. hasGmailToken ne couvre que le scope readonly.
  if (!hasValidToken(clientId, GMAIL_MODIFY_SCOPE)) return;
  const last = Number(localStorage.getItem(RENEWED_KEY) ?? 0);
  if (Date.now() - last < RENEW_EVERY_MS) return;
  const { gmailTopic } = await fetchPushConfig(config);
  if (!gmailTopic) return;
  await googleRequest(
    clientId,
    GMAIL_MODIFY_SCOPE,
    "https://gmail.googleapis.com/gmail/v1/users/me/watch",
    {
      method: "POST",
      json: true,
      body: JSON.stringify({ topicName: gmailTopic, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
    },
    "Gmail watch",
  );
  const accessToken = await requestAccessToken(clientId, { scope: GMAIL_MODIFY_SCOPE, prompt: "" });
  const base = config.serverUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/push/mail-watch?vault=${encodeURIComponent(config.vaultKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(config.token ? { "x-sync-token": config.token } : {}) },
    body: JSON.stringify({ accessToken }),
  });
  if (!res.ok) throw new Error(`mail-watch ${res.status}`);
  localStorage.setItem(RENEWED_KEY, String(Date.now()));
}

export function mailGrantEmail(): string {
  try {
    return localStorage.getItem(GRANTED_KEY) ?? "";
  } catch {
    return "";
  }
}

export function mailGrantPromptDismissed(): boolean {
  try {
    return Number(localStorage.getItem(GRANT_PROMPT_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export function dismissMailGrantPrompt(): void {
  try {
    localStorage.setItem(GRANT_PROMPT_KEY, String(Date.now() + GRANT_PROMPT_SNOOZE_MS));
  } catch {
    /* rien à retenir */
  }
}

/** Confie un refresh token Gmail au serveur : les pushs portent expéditeur et objet même app fermée. Geste utilisateur requis. */
export async function grantMailAccess(clientId: string, config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<string> {
  const code = await requestOfflineCode(clientId, GMAIL_MODIFY_SCOPE);
  const base = config.serverUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/push/mail-grant?vault=${encodeURIComponent(config.vaultKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(config.token ? { "x-sync-token": config.token } : {}) },
    body: JSON.stringify({ code, clientId }),
  });
  if (res.status === 409) {
    throw new Error(
      "Google n'a pas renvoyé d'accès hors ligne : retire Supernote dans myaccount.google.com/permissions puis réessaie.",
    );
  }
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error;
    throw new Error(`Le serveur a refusé l'autorisation : ${typeof detail === "string" ? detail : `HTTP ${res.status}`}.`);
  }
  const { email } = (await res.json()) as { email: string };
  localStorage.setItem(GRANTED_KEY, email);
  return email;
}
