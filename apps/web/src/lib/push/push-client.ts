import {
  getOrCreateClientId,
  loadOnlineSyncConfig,
  type OnlineSyncConfig,
} from "@/lib/online-sync/config-storage";
import { swKvSet } from "@/lib/sw-kv";

export type PushCategory = "reminder" | "event" | "followup" | "snooze" | "habit";

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

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : isIos() ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Appareil";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${os} · ${browser}` : os;
}

async function registerOnServer(config: OnlineSyncConfig, sub: PushSubscription): Promise<void> {
  const res = await fetch(apiUrl(config, "/api/push/subscribe", true), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ deviceId: getOrCreateClientId(), subscription: sub.toJSON(), label: deviceLabel() }),
  });
  if (!res.ok) throw refusal(res.status);
  // Le SW n'a ni la config du salon ni l'URL du serveur : il en a besoin pour « Archiver » et « Dans X ».
  await swKvSet("pushServer", config.serverUrl.replace(/\/+$/, "")).catch(() => undefined);
  await sendPushPrefs(loadDevicePrefs(), config).catch((err: unknown) => console.warn("[push] préférences", err));
}

export async function currentEndpoint(): Promise<string> {
  if (!("serviceWorker" in navigator)) return "";
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  return sub?.endpoint ?? "";
}

export interface PushDevicePrefs {
  mail: "people" | "all" | "off";
  reminder: boolean;
  event: boolean;
  habit: boolean;
  followup: boolean;
  quiet: { on: boolean; start: string; end: string };
}

export const DEFAULT_DEVICE_PREFS: PushDevicePrefs = {
  mail: "people",
  reminder: true,
  event: true,
  habit: true,
  followup: true,
  quiet: { on: true, start: "22:00", end: "07:30" },
};

const DEVICE_PREFS_KEY = "supernote.push.devicePrefs";

export function loadDevicePrefs(): PushDevicePrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DEVICE_PREFS_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      const p = raw as Partial<PushDevicePrefs>;
      return { ...DEFAULT_DEVICE_PREFS, ...p, quiet: { ...DEFAULT_DEVICE_PREFS.quiet, ...(p.quiet ?? {}) } };
    }
  } catch {
    /* stockage indisponible : défauts */
  }
  return DEFAULT_DEVICE_PREFS;
}

export async function sendPushPrefs(prefs: PushDevicePrefs, config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  try {
    localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* le serveur reste la référence */
  }
  const endpoint = await currentEndpoint();
  if (!endpoint) return;
  const res = await fetch(apiUrl(config, "/api/push/prefs", false), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint, prefs: { ...prefs, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }),
  });
  if (!res.ok) throw new Error(`Préférences refusées par le serveur (HTTP ${res.status}).`);
}

export async function sendTestPush(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  const endpoint = await currentEndpoint();
  if (!endpoint) throw new Error("Cet appareil n'est pas abonné aux notifications.");
  const res = await fetch(apiUrl(config, "/api/push/test", false), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; status?: number } | null;
  if (res.status === 404) throw new Error("Abonnement inconnu du serveur : désactive puis réactive les notifications.");
  if (!res.ok || !body?.ok) throw new Error(`Le service push a refusé l'envoi (${body?.status || res.status}).`);
}

export interface PushDevice {
  endpoint: string;
  label: string;
  createdAt: number;
  lastOkAt: number | null;
  mine: boolean;
}

export async function listPushDevices(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<PushDevice[]> {
  const mine = await currentEndpoint();
  const res = await fetch(`${apiUrl(config, "/api/push/devices", true)}&endpoint=${encodeURIComponent(mine)}`, {
    headers: headers(config),
  });
  if (!res.ok) throw refusal(res.status);
  const body = (await res.json()) as { devices?: PushDevice[] };
  return (body.devices ?? []).sort((a, b) => Number(b.mine) - Number(a.mine) || (b.lastOkAt ?? 0) - (a.lastOkAt ?? 0));
}

export async function removePushDevice(endpoint: string, config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  const res = await fetch(apiUrl(config, "/api/push/unsubscribe", false), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw new Error(`Retrait refusé (HTTP ${res.status}).`);
}

export async function fetchPushConfig(
  config: OnlineSyncConfig = loadOnlineSyncConfig(),
): Promise<{ publicKey: string; gmailTopic: string; mailGrant: boolean }> {
  const res = await fetch(apiUrl(config, "/api/push/key", false));
  const body = res.ok
    ? ((await res.json().catch(() => null)) as { publicKey?: unknown; gmailTopic?: unknown; mailGrant?: unknown } | null)
    : null;
  return {
    publicKey: typeof body?.publicKey === "string" ? body.publicKey : "",
    gmailTopic: typeof body?.gmailTopic === "string" ? body.gmailTopic : "",
    mailGrant: body?.mailGrant === true,
  };
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
  const { publicKey: key } = await fetchPushConfig(config);
  if (!key) {
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

export const PUSH_PROMPT_KEY = "supernote.push.promptDismissedUntil";
const PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60_000;

export type PushPrompt = "hidden" | "ask" | "protect" | "install";

export function pushPromptState(config: OnlineSyncConfig = loadOnlineSyncConfig()): PushPrompt {
  if (typeof Notification === "undefined" && pushAvailability(config) !== "ios-not-installed") return "hidden";
  try {
    if (Number(localStorage.getItem(PUSH_PROMPT_KEY) ?? 0) > Date.now()) return "hidden";
  } catch {
    /* stockage indisponible : on montre le bandeau */
  }
  const availability = pushAvailability(config);
  if (availability === "ios-not-installed") return "install";
  if (availability === "no-password") return "protect";
  if (availability !== "ok" || Notification.permission !== "default") return "hidden";
  return "ask";
}

export function dismissPushPrompt(): void {
  try {
    localStorage.setItem(PUSH_PROMPT_KEY, String(Date.now() + PROMPT_SNOOZE_MS));
  } catch {
    /* rien à retenir */
  }
}

/** Permission déjà accordée : abonne sans geste. Sinon le bandeau prend le relais. */
export async function ensurePushSubscription(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  if (pushAvailability(config) !== "ok" || Notification.permission !== "granted") return;
  await refreshPushSubscription(config);
}
