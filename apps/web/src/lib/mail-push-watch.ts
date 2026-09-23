import { googleRequest } from "@/lib/google-api";
import { GMAIL_MODIFY_SCOPE } from "@/lib/gmail";
import { hasValidToken, requestAccessToken } from "@/lib/google-drive";
import { loadOnlineSyncConfig, type OnlineSyncConfig } from "@/lib/online-sync/config-storage";
import { fetchPushConfig, pushAvailability } from "@/lib/push/push-client";

const RENEWED_KEY = "supernote.mailWatch.renewedAt";
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
