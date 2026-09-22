import {
  getOrCreateClientId,
  loadOnlineSyncConfig,
  type OnlineSyncConfig,
} from "@/lib/online-sync/config-storage";

export type PushCategory = "reminder" | "event" | "followup" | "snooze";

export interface PushScheduleRow {
  key: string;
  fireAt: number;
  title: string;
  body: string;
  url: string;
  joinUrl: string;
}

export type PushAvailability = "ok" | "ios-not-installed" | "unsupported" | "no-sync" | "no-password";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function pushAvailability(config: OnlineSyncConfig = loadOnlineSyncConfig()): PushAvailability {
  if (typeof navigator === "undefined") return "unsupported";
  if (isIos() && (navigator as Navigator & { standalone?: boolean }).standalone !== true) return "ios-not-installed";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (!config.enabled || !config.vaultKey) return "no-sync";
  // Un salon protégé exige son mot de passe sur chaque appareil : sans jeton, le salon est libre.
  if (!config.token) return "no-password";
  return "ok";
}

function apiUrl(config: OnlineSyncConfig, path: string, withVault: boolean): string {
  const base = `${config.serverUrl.replace(/\/+$/, "")}${path}`;
  return withVault ? `${base}?vault=${encodeURIComponent(config.vaultKey)}` : base;
}

function headers(config: OnlineSyncConfig): Record<string, string> {
  return config.token
    ? { "content-type": "application/json", "x-sync-token": config.token }
    : { "content-type": "application/json" };
}

function refusal(status: number): Error {
  if (status === 403) return new Error("Protège ton salon par un mot de passe pour activer les notifications.");
  if (status === 401) return new Error("Mot de passe du salon refusé.");
  return new Error(`Le serveur a refusé l'abonnement (HTTP ${status}).`);
}

function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registerOnServer(config: OnlineSyncConfig, sub: PushSubscription): Promise<void> {
  const res = await fetch(apiUrl(config, "/api/push/subscribe", true), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ deviceId: getOrCreateClientId(), subscription: sub.toJSON() }),
  });
  if (!res.ok) throw refusal(res.status);
}

export async function subscribePush(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications bloquées par le navigateur : autorise-les dans les réglages du site."
        : "Autorisation de notifier non accordée.",
    );
  }
  const keyRes = await fetch(apiUrl(config, "/api/push/key", false));
  const keyBody = keyRes.ok ? ((await keyRes.json().catch(() => null)) as { publicKey?: unknown } | null) : null;
  const key = keyBody?.publicKey;
  if (typeof key !== "string" || !key) {
    throw new Error("Le serveur n'envoie pas de notifications push (clés VAPID absentes).");
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("Service worker indisponible : recharge la page puis réessaie.");
  // Une clé VAPID changée rend l'ancien abonnement inutilisable : on repart d'un neuf.
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  // Uint8Array<ArrayBufferLike> vs BufferSource<ArrayBuffer> : divergence de lib.dom, valeur correcte au runtime.
  const applicationServerKey = base64UrlToBytes(key) as BufferSource;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  await registerOnServer(config, sub);
}

export async function unsubscribePush(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!sub) return;
  // Hors ligne, le serveur l'apprendra par un 410 au prochain envoi.
  await fetch(apiUrl(config, "/api/push/unsubscribe", false), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined);
  await sub.unsubscribe();
}

/** Abonnement perdu (410) ou salon changé : réabonne ou ré-enregistre sans geste utilisateur. */
export async function refreshPushSubscription(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await registerOnServer(config, sub);
  else await subscribePush(config);
}

let lastSent = "";

export async function sendPushSchedule(
  categories: Partial<Record<PushCategory, PushScheduleRow[]>>,
  keepalive = false,
  config: OnlineSyncConfig = loadOnlineSyncConfig(),
): Promise<void> {
  const body = JSON.stringify({ deviceId: getOrCreateClientId(), categories });
  const stamp = `${config.vaultKey}\n${body}`;
  if (stamp === lastSent) return;
  const res = await fetch(apiUrl(config, "/api/push/schedule", true), {
    method: "PUT",
    headers: headers(config),
    body,
    // Chrome refuse un corps keepalive au-delà de 64 Ko.
    keepalive: keepalive && new Blob([body]).size < 60_000,
  });
  if (!res.ok) throw new Error(`push schedule ${res.status}`);
  lastSent = stamp;
}
