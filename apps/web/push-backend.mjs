import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createPushStore } from "./push-store.mjs";

const CATEGORIES = ["reminder", "event", "followup", "snooze", "habit"];
const SHARED = new Set(["reminder", "event", "habit"]);
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const MISSED_MS = 15 * 60 * 1000;
const MAX_ROWS = 200;
const MAX_BODY_BYTES = 1024 * 1024;
const TICK_MS = 30_000;
const TTL_S = 15 * 60;
// Chaque push mail porte l'état entier : un push remplacé par le suivant (topic) ne perd rien, il peut donc attendre 6 h.
const MAIL_TTL_S = 6 * 60 * 60;
const RECENT_MS = 6 * 60 * 60 * 1000;
const MAIL_ITEMS = 5;
const LATER_KINDS = /^(reminder|event|followup|snooze|habit|mail):/;

export const DEFAULT_PREFS = Object.freeze({
  mail: "people",
  reminder: true,
  event: true,
  habit: true,
  followup: true,
  quiet: Object.freeze({ on: true, start: "22:00", end: "07:30" }),
  tz: "Europe/Paris",
});
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validPrefs(p) {
  if (!p || typeof p !== "object" || !["people", "all", "off"].includes(p.mail)) return null;
  const flags = ["reminder", "event", "habit", "followup"];
  if (flags.some((k) => typeof p[k] !== "boolean")) return null;
  const q = p.quiet;
  if (!q || typeof q.on !== "boolean" || !HHMM.test(q.start) || !HHMM.test(q.end)) return null;
  if (typeof p.tz !== "string" || p.tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: p.tz });
  } catch {
    return null;
  }
  return { mail: p.mail, ...Object.fromEntries(flags.map((k) => [k, p[k]])), quiet: { on: q.on, start: q.start, end: q.end }, tz: p.tz };
}

export function parsePrefs(text) {
  try {
    return (text && validPrefs(JSON.parse(text))) || DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export function inQuiet(prefs, now = Date.now()) {
  if (!prefs.quiet.on) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: prefs.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now);
  const at = Number(parts.find((x) => x.type === "hour")?.value) * 60 + Number(parts.find((x) => x.type === "minute")?.value);
  const start = minutesOf(prefs.quiet.start);
  const end = minutesOf(prefs.quiet.end);
  return start <= end ? at >= start && at < end : at >= start || at < end;
}

const categoryOn = (prefs, category) =>
  category === "later" || (category === "snooze" ? prefs.followup : prefs[category] !== false);

const mailWanted = (mode, cls) => (mode === "all" ? cls !== "self" : mode === "people" && cls === "person");

const addressOf = (from) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
const domainOf = (address) => address.split("@")[1] ?? "";

// Ordre voulu : un faux « auto » fait taire un humain, donc les signaux humains forts passent avant les signaux de masse.
export function classifyMail({ labelIds = [], from = "", headers = {} }, watched) {
  const address = addressOf(from);
  if (labelIds.includes("SENT") || address === watched) return "self";
  const autoSubmitted = String(headers["auto-submitted"] ?? "").trim().toLowerCase();
  if (/no-?reply|do-?not-?reply|ne-?pas-?repondre|mailer-daemon/.test(address.split("@")[0] ?? "")) return "auto";
  if (autoSubmitted && autoSubmitted !== "no") return "auto";
  if (domainOf(address) && domainOf(address) === domainOf(watched)) return "person";
  // UPDATES hors domaine : banque, transport, agenda… (vérifié sur la boîte réelle, sans motif noreply ni en-tête de liste).
  if (["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES"].some((l) => labelIds.includes(l))) return "auto";
  if (headers["list-unsubscribe"] || /^(bulk|junk)$/i.test(String(headers.precedence ?? "").trim())) return "auto";
  return "person";
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sync-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

// Même résolution que le navigateur : « /\evil » et « /\t/evil » deviennent « //evil ».
function isInternalPath(url) {
  if (typeof url !== "string" || !url.startsWith("/")) return false;
  try {
    return new URL(url, "https://supernote.invalid").origin === "https://supernote.invalid";
  } catch {
    return false;
  }
}

function cleanRow(category, item, now) {
  if (!item || typeof item !== "object") return null;
  const { key, fireAt, title, body, url, joinUrl } = item;
  if (typeof key !== "string" || !key.startsWith(`${category}:`) || key.length > 512) return null;
  if (!Number.isInteger(fireAt) || fireAt < now - MISSED_MS || fireAt > now + HORIZON_MS) return null;
  if (!isInternalPath(url)) return null;
  if (typeof joinUrl !== "string" || (joinUrl !== "" && !joinUrl.startsWith("https://"))) return null;
  if (typeof title !== "string" || typeof body !== "string") return null;
  return { key, fireAt, title: title.slice(0, 120), body: body.slice(0, 240), url, joinUrl };
}

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req)).toString("utf8"));
  } catch {
    return null;
  }
}

const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

function sealer(keyB64) {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) return null;
  return {
    seal(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
    },
    open(sealed) {
      try {
        const [iv, tag, ct] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}

async function googleOAuthToken(params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`google token ${res.status}`), { code: json?.error, detail: json?.error_description });
  return json;
}

async function gmailApi(token, path, init = {}) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) throw Object.assign(new Error(`gmail ${res.status}`), { status: res.status });
  return res.json();
}

const senderName = (from) => (from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? from).trim();

export async function createPushBackend({ vaultAuthed, vaultProtected }) {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "";
  if (!publicKey || !privateKey || !subject) {
    console.log("[push] désactivé : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ou VAPID_SUBJECT absente");
    return { enabled: false, handle: () => false };
  }
  const { default: webpush } = await import("web-push");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const store = await createPushStore();
  console.log(`[push] web push ENABLED (${store.kind} store at ${store.label})`);

  const gmailTopic = process.env.GMAIL_PUBSUB_TOPIC ?? "";
  const gmailSecret = process.env.GMAIL_PUSH_SECRET ?? "";
  const mailEnabled = Boolean(gmailTopic && gmailSecret);
  const MAIL_COALESCE_MS = 30_000;
  const MAIL_WATCH_TTL_MS = 8 * 24 * 60 * 60 * 1000;
  const WATCH_RENEW_MS = 24 * 60 * 60 * 1000;

  // Refresh token Gmail gardé côté serveur : le push porte expéditeur et objet même app fermée depuis des jours.
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const tokenSeal = mailEnabled && googleSecret ? sealer(process.env.GOOGLE_TOKEN_KEY ?? "") : null;
  if (mailEnabled && !tokenSeal) {
    console.log("[push] mails détaillés désactivés : GOOGLE_CLIENT_SECRET ou GOOGLE_TOKEN_KEY (32 octets base64) absente");
  }
  const accessTokens = new Map(); // email → { token, expiresAt, scope }

  async function grantToken(grant) {
    const cached = accessTokens.get(grant.email);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
    const refreshToken = tokenSeal.open(grant.refreshtoken);
    try {
      if (!refreshToken) throw Object.assign(new Error("refresh token illisible"), { code: "invalid_grant" });
      const json = await googleOAuthToken({
        client_id: grant.clientid,
        client_secret: googleSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      const entry = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000, scope: json.scope ?? "" };
      accessTokens.set(grant.email, entry);
      return entry;
    } catch (err) {
      if (err?.code === "invalid_grant") {
        await store.removeMailGrant(grant.email);
        console.log("[push] autorisation Gmail révoquée ou illisible, retirée");
      }
      throw err;
    }
  }

  async function detailedMail(email) {
    const grant = await store.getMailGrant(email);
    if (!grant) return null;
    try {
      const { token } = await grantToken(grant);
      let hist;
      try {
        // Sans filtre labelId : un retrait d'INBOX ne porterait plus le libellé filtré.
        hist = await gmailApi(
          token,
          `history?startHistoryId=${encodeURIComponent(grant.lasthistoryid)}&historyTypes=messageAdded&historyTypes=labelRemoved&maxResults=500`,
        );
      } catch (err) {
        if (err?.status !== 404) throw err;
        // startHistoryId trop ancien : on repart de l'état présent, ce push reste générique.
        const profile = await gmailApi(token, "profile");
        await store.setMailGrantHistory(email, String(profile.historyId));
        return null;
      }
      if (hist?.historyId) await store.setMailGrantHistory(email, String(hist.historyId));
      const records = hist?.history ?? [];
      const addedIds = [...new Set(
        records.flatMap((h) => h.messagesAdded ?? []).map((m) => m.message)
          .filter((m) => m?.labelIds?.includes("INBOX")).map((m) => m.id),
      )].slice(-10);
      const closed = new Set(
        records.flatMap((h) => h.labelsRemoved ?? [])
          .filter((r) => r.labelIds?.includes("INBOX") || r.labelIds?.includes("UNREAD"))
          .map((r) => String(r.message?.threadId ?? "")).filter(Boolean),
      );
      const metaPath = (id) =>
        `messages/${id}?format=metadata${["From", "Subject", "List-Unsubscribe", "Precedence", "Auto-Submitted"].map((h) => `&metadataHeaders=${h}`).join("")}`;
      // Seul un message supprimé entre-temps (404) est sauté : une autre erreur retombe sur le push générique.
      const metas = (await Promise.all(addedIds.map((id) => gmailApi(token, metaPath(id)).catch((err) => {
        if (err?.status === 404) return null;
        throw err;
      })))).filter(Boolean);
      const inbox = await gmailApi(token, "labels/INBOX");
      const added = metas
        // Libellés actuels : un message déjà lu ou archivé pendant la coalescence ne sonne plus.
        .filter((m) => m.labelIds?.includes("INBOX") && m.labelIds?.includes("UNREAD"))
        .map((m) => {
          const headers = Object.fromEntries((m.payload?.headers ?? []).map((h) => [String(h.name).toLowerCase(), String(h.value ?? "")]));
          return {
            messageId: String(m.id),
            threadId: String(m.threadId ?? ""),
            from: senderName(headers.from ?? "").slice(0, 80),
            subject: (headers.subject ?? "").slice(0, 160),
            cls: classifyMail({ labelIds: m.labelIds ?? [], from: headers.from ?? "", headers }, email),
          };
        });
      for (const item of added) closed.delete(item.threadId);
      return { added, closed: [...closed], badge: inbox?.threadsUnread ?? inbox?.messagesUnread ?? 0 };
    } catch (err) {
      console.warn(`[push] lecture Gmail côté serveur échouée (${err?.message ?? err})`);
      return null;
    }
  }

  // Le watch Gmail expire au bout de 7 jours : sans ça il dépendrait d'une page ouverte dans la semaine.
  async function renewWatches() {
    for (const grant of await store.listStaleMailGrants(Date.now() - WATCH_RENEW_MS)) {
      try {
        const { token } = await grantToken(grant);
        await gmailApi(token, "watch", {
          method: "POST",
          body: JSON.stringify({ topicName: gmailTopic, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
        });
        await store.touchMailWatch(grant.email);
      } catch (err) {
        console.warn(`[push] renouvellement du watch Gmail échoué (${err?.message ?? err})`);
      } finally {
        await store.markMailGrantWatched(grant.email);
      }
    }
  }

  // Topic : 32 caractères base64url au plus, et `key` contient des « @ » (id d'agenda = adresse).
  const topicOf = (key) => createHash("sha256").update(key).digest("base64url").slice(0, 32);

  async function deliver(sub, payload, topic, ttl = TTL_S) {
    try {
      // urgency high : Android en veille diffère les messages « normal ».
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: ttl, topic, urgency: "high" },
      );
      await store.markSubscriptionOk(sub.endpoint);
      return { ok: true };
    } catch (err) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        await store.removeSubscription(sub.endpoint);
        console.log(`[push] abonnement expiré retiré (${status})`);
      } else {
        console.warn(`[push] envoi refusé (${status ?? err})`);
      }
      return { ok: false, status: status ?? 0 };
    }
  }

  // Une rafale Pub/Sub (lecture, archivage, plusieurs arrivées) ne fait qu'un push par fenêtre.
  // Clé par adresse : la lecture Gmail avance lasthistoryid, un second salon du même compte recevrait une liste vide.
  const mailPending = new Map(); // email → { lastSentAt, timer, historyId }
  // shortcut: en mémoire, perdu au redémarrage (on perd seulement le rattrapage) ; un seul conteneur web, à passer en base s'il y en a plusieurs.
  const recentMail = new Map(); // email → Map(threadId → { messageId, threadId, from, subject, cls, at, sentTo: Set<endpoint> })

  async function sendMail(email, historyId) {
    const detail = tokenSeal ? await detailedMail(email) : null;
    const vaults = await store.listMailWatchVaults(email);
    if (!detail) {
      // Sans lecture serveur, le SW lit Gmail lui-même avec le jeton de la page : pas de tri possible ici.
      let count = 0;
      for (const vault of vaults) {
        const subs = (await store.listSubscriptions(vault)).filter((sub) => parsePrefs(sub.prefs).mail !== "off");
        count += subs.length;
        await Promise.all(subs.map((sub) => deliver(sub, JSON.stringify({
          kind: "mail", title: "Nouveau mail", body: "", url: "/mail", tag: "mail-new", historyId, email,
          silent: inQuiet(parsePrefs(sub.prefs)),
        }), topicOf(`mail:${email}`))));
      }
      console.log(`[push] mail → ${count} abonnement(s)`);
      return;
    }
    const now = Date.now();
    const state = recentMail.get(email) ?? new Map();
    recentMail.set(email, state);
    for (const [threadId, item] of state) if (now - item.at > RECENT_MS) state.delete(threadId);
    const closedFor = new Map(); // threadId → abonnements qui l'avaient reçu
    for (const threadId of detail.closed) {
      const item = state.get(threadId);
      if (!item) continue;
      closedFor.set(threadId, item.sentTo);
      state.delete(threadId);
    }
    for (const item of detail.added) {
      state.set(item.threadId, { ...item, at: now, sentTo: state.get(item.threadId)?.sentTo ?? new Set() });
    }
    const fresh = new Set(detail.added.map((i) => i.messageId));
    let sent = 0;
    let freshCount = 0;
    let closeCount = 0;
    for (const vault of vaults) {
      for (const sub of await store.listSubscriptions(vault)) {
        const prefs = parsePrefs(sub.prefs);
        const items = [...state.values()]
          .filter((i) => mailWanted(prefs.mail, i.cls))
          .sort((a, b) => b.at - a.at)
          .slice(0, MAIL_ITEMS);
        const close = [...closedFor].filter(([, to]) => to.has(sub.endpoint)).map(([threadId]) => threadId).slice(0, 20);
        const news = items.filter((i) => fresh.has(i.messageId)).length;
        if (news === 0 && close.length === 0) continue;
        const shape = ({ messageId, threadId, from, subject, cls }) => ({ messageId, threadId, from, subject, cls });
        const payload = JSON.stringify({
          kind: "mail",
          // Titre relayé au tiroir in-app quand une fenêtre est visible.
          title: "Nouveau mail",
          email,
          historyId,
          badge: detail.badge,
          // `items` = nouveaux seulement : un SW d'avant la refonte les affiche tels quels sans fausse alerte.
          items: items.filter((i) => fresh.has(i.messageId)).map(shape),
          recent: items.map(shape),
          close,
          silent: inQuiet(prefs, now),
        });
        const { ok } = await deliver(sub, payload, topicOf(`mail:${email}`), MAIL_TTL_S);
        if (!ok) continue;
        for (const item of items) item.sentTo.add(sub.endpoint);
        sent += 1;
        freshCount += news;
        closeCount += close.length;
      }
    }
    const tally = (cls) => detail.added.filter((i) => i.cls === cls).length;
    console.log(
      `[push] mail → ${sent} abonnement(s), ${freshCount} nouveau(x), ${closeCount} fermé(s) ` +
        `[reçus : ${tally("person")} personne(s), ${tally("auto")} auto, ${tally("self")} soi] (détaillé)`,
    );
  }

  // Le serveur n'archive que ce qu'il a lui-même notifié à cet appareil, dans les 6 dernières heures.
  async function archiveNotified(sub, threadId) {
    for (const [email, state] of recentMail) {
      const item = state.get(threadId);
      if (!item?.sentTo.has(sub.endpoint) || Date.now() - item.at > RECENT_MS) continue;
      if (!(await store.listMailWatchVaults(email)).includes(sub.vault)) continue;
      const grant = await store.getMailGrant(email);
      if (!grant) return null;
      const { token } = await grantToken(grant);
      await gmailApi(token, `threads/${encodeURIComponent(threadId)}/modify`, {
        method: "POST",
        body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
      });
      const inbox = await gmailApi(token, "labels/INBOX");
      return { badge: inbox?.threadsUnread ?? inbox?.messagesUnread ?? 0 };
    }
    return null;
  }

  function queueMail(email, historyId) {
    const entry = mailPending.get(email) ?? { lastSentAt: 0, timer: null, historyId };
    entry.historyId = historyId;
    mailPending.set(email, entry);
    if (entry.timer) return;
    const wait = Math.max(0, entry.lastSentAt + MAIL_COALESCE_MS - Date.now());
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.lastSentAt = Date.now();
      void sendMail(email, entry.historyId).catch((err) => console.warn("[push] mail", err));
    }, wait);
    if (typeof entry.timer.unref === "function") entry.timer.unref();
  }

  async function tick() {
    try {
      const now = Date.now();
      const subsByVault = new Map();
      for (const row of await store.claimDue(now)) {
        if (now - Number(row.fireat) > MISSED_MS) continue;
        if (!subsByVault.has(row.vault)) subsByVault.set(row.vault, await store.listSubscriptions(row.vault));
        // « Dans X » ne revient que sur l'appareil qui l'a demandé.
        const subs = subsByVault.get(row.vault).filter((sub) =>
          row.category === "later" ? sub.deviceid === row.deviceid : categoryOn(parsePrefs(sub.prefs), row.category),
        );
        await Promise.all(subs.map((sub) => deliver(sub, JSON.stringify({
          title: row.title,
          body: row.body,
          url: row.url,
          tag: row.key,
          joinUrl: row.joinurl,
          at: Number(row.fireat),
          silent: inQuiet(parsePrefs(sub.prefs), now),
        }), topicOf(row.key))));
        console.log(`[push] ${row.category} → ${subs.length} abonnement(s)`);
      }
      await store.purgeSent(now - HORIZON_MS);
      await store.purgeMailWatch(now - MAIL_WATCH_TTL_MS);
      if (tokenSeal) await renewWatches();
    } catch (err) {
      console.warn("[push] tour du planificateur échoué", err);
    }
  }
  const timer = setInterval(() => void tick(), TICK_MS);
  if (typeof timer.unref === "function") timer.unref();

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    if (!path.startsWith("/api/push/")) return false;

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return true;
    }

    if (path === "/api/push/key" && req.method === "GET") {
      sendJson(res, 200, { publicKey, gmailTopic: mailEnabled ? gmailTopic : "", mailGrant: Boolean(tokenSeal) });
      return true;
    }

    // L'endpoint est lui-même le secret : pas d'authentification de salon.
    if (path === "/api/push/unsubscribe" && req.method === "POST") {
      const body = await readJson(req);
      if (typeof body?.endpoint !== "string") {
        sendJson(res, 400, { error: "missing endpoint" });
        return true;
      }
      await store.removeSubscription(body.endpoint);
      sendJson(res, 200, { ok: true });
      return true;
    }

    // Routes appelées par l'appareil lui-même, souvent depuis le SW qui n'a pas le mot de passe du salon : l'endpoint fait foi.
    if (["/api/push/test", "/api/push/prefs", "/api/push/later", "/api/push/archive"].includes(path)) {
      const body = await readJson(req);
      const sub = typeof body?.endpoint === "string" ? await store.getSubscription(body.endpoint) : null;
      if (!sub) {
        sendJson(res, 404, { error: "unknown subscription" });
        return true;
      }

      if (path === "/api/push/test" && req.method === "POST") {
        const prefs = parsePrefs(sub.prefs);
        const at = new Date().toLocaleTimeString("fr-FR", { timeZone: prefs.tz, hour: "2-digit", minute: "2-digit" });
        const result = await deliver(sub, JSON.stringify({ title: "Test Supernote", body: `Envoyé à ${at}`, url: "/parametres", tag: "test", joinUrl: "" }), topicOf(`test:${sub.endpoint}`));
        sendJson(res, 200, result);
        return true;
      }

      if (path === "/api/push/prefs" && req.method === "PUT") {
        const prefs = validPrefs(body?.prefs);
        if (!prefs) {
          sendJson(res, 400, { error: "invalid prefs" });
          return true;
        }
        await store.setPrefs(sub.endpoint, JSON.stringify(prefs));
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (path === "/api/push/later" && req.method === "POST") {
        const { key, title, body: text, url: target, joinUrl, delayMs } = body;
        const valid =
          typeof key === "string" && key.length <= 480 && LATER_KINDS.test(key) &&
          typeof title === "string" && typeof text === "string" && isInternalPath(target) &&
          typeof joinUrl === "string" && (joinUrl === "" || joinUrl.startsWith("https://")) &&
          Number.isInteger(delayMs) && delayMs >= 60_000 && delayMs <= 24 * 60 * 60 * 1000;
        if (!valid) {
          sendJson(res, 400, { error: "invalid later" });
          return true;
        }
        await store.insertSchedule({ vault: sub.vault, deviceId: sub.deviceid, category: "later" }, [{
          key: `later:${key}`, fireAt: Date.now() + delayMs, title: title.slice(0, 120), body: text.slice(0, 240), url: target, joinUrl,
        }]);
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (path === "/api/push/archive" && req.method === "POST") {
        const threadId = body?.threadId;
        if (typeof threadId !== "string" || !/^[0-9a-f]{1,32}$/i.test(threadId)) {
          sendJson(res, 400, { error: "invalid threadId" });
          return true;
        }
        try {
          const done = tokenSeal ? await archiveNotified(sub, threadId) : null;
          sendJson(res, done ? 200 : 403, done ? { ok: true, badge: done.badge } : { error: "not notified here" });
        } catch (err) {
          console.warn(`[push] archivage serveur échoué (${err?.message ?? err})`);
          sendJson(res, 502, { error: "gmail refused" });
        }
        return true;
      }

      sendJson(res, 405, { error: "method not allowed" });
      return true;
    }

    // La clé fait foi : pas d'authentification de salon (Pub/Sub n'en porte pas).
    if (path === "/api/push/gmail" && req.method === "POST") {
      const given = Buffer.from(url.searchParams.get("key") ?? "");
      const expected = Buffer.from(gmailSecret);
      if (!mailEnabled || given.length !== expected.length || !timingSafeEqual(given, expected)) {
        sendJson(res, 403, { error: "forbidden" });
        return true;
      }
      const body = await readJson(req);
      res.writeHead(204, CORS);
      res.end();
      try {
        const data = JSON.parse(Buffer.from(body?.message?.data ?? "", "base64").toString("utf8"));
        const email = typeof data?.emailAddress === "string" ? data.emailAddress.toLowerCase() : "";
        const historyId = data?.historyId != null ? String(data.historyId) : "";
        if (!email || !historyId) return true;
        queueMail(email, historyId);
      } catch {
        /* message Pub/Sub illisible : acquitté, ignoré */
      }
      return true;
    }

    const vault = url.searchParams.get("vault") ?? "";
    if (!vault) {
      sendJson(res, 400, { error: "missing vault" });
      return true;
    }
    if (!(await vaultAuthed(req, url, vault))) {
      sendJson(res, 401, { error: "unauthorized" });
      return true;
    }
    if (!(await vaultProtected(vault))) {
      sendJson(res, 403, { error: "vault not protected" });
      return true;
    }

    if (path === "/api/push/mail-watch" && req.method === "POST") {
      if (!mailEnabled) {
        sendJson(res, 404, { error: "mail push disabled" });
        return true;
      }
      const body = await readJson(req);
      const accessToken = body?.accessToken;
      if (typeof accessToken !== "string" || !accessToken) {
        sendJson(res, 400, { error: "missing accessToken" });
        return true;
      }
      // Preuve que l'appelant possède l'adresse ; le jeton n'est ni gardé ni journalisé.
      const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const email = typeof profile?.emailAddress === "string" ? profile.emailAddress.toLowerCase() : "";
      if (!email) {
        sendJson(res, 400, { error: "gmail profile refused" });
        return true;
      }
      await store.upsertMailWatch({ email, vault });
      sendJson(res, 200, { ok: true, email });
      return true;
    }

    if (path === "/api/push/mail-grant" && req.method === "POST") {
      if (!tokenSeal) {
        sendJson(res, 404, { error: "mail grant disabled" });
        return true;
      }
      const body = await readJson(req);
      const code = body?.code;
      const clientId = body?.clientId;
      if (typeof code !== "string" || !code || typeof clientId !== "string" || !clientId) {
        console.warn("[push] mail-grant : code ou clientId absent");
        sendJson(res, 400, { error: "code ou identifiant client absent" });
        return true;
      }
      let tokens;
      try {
        // « postmessage » : redirect_uri imposée par le mode popup de GIS.
        tokens = await googleOAuthToken({
          code,
          client_id: clientId,
          client_secret: googleSecret,
          redirect_uri: "postmessage",
          grant_type: "authorization_code",
        });
      } catch (err) {
        console.warn(`[push] mail-grant : échange du code refusé par Google (${err?.code ?? err?.message ?? "?"} : ${err?.detail ?? "-"}) client_id=${clientId}`);
        sendJson(res, 400, { error: `échange du code refusé par Google (${err?.code ?? "?"})` });
        return true;
      }
      if (!String(tokens?.scope ?? "").split(" ").includes(GMAIL_MODIFY_SCOPE)) {
        console.warn(`[push] mail-grant : scope Gmail absent (accordés : ${tokens?.scope ?? "aucun"})`);
        sendJson(res, 400, { error: "accès Gmail non accordé dans la fenêtre Google" });
        return true;
      }
      // Google ne renvoie le refresh token qu'au premier consentement hors ligne.
      if (!tokens.refresh_token) {
        console.warn("[push] mail-grant : pas de refresh token renvoyé");
        sendJson(res, 409, { error: "no refresh token" });
        return true;
      }
      const profile = await gmailApi(tokens.access_token, "profile").catch((err) => {
        console.warn(`[push] mail-grant : profil Gmail refusé (${err?.message ?? err})`);
        return null;
      });
      const email = typeof profile?.emailAddress === "string" ? profile.emailAddress.toLowerCase() : "";
      if (!email || profile?.historyId == null) {
        sendJson(res, 400, { error: "profil Gmail refusé" });
        return true;
      }
      await store.upsertMailGrant({
        email,
        clientId,
        refreshToken: tokenSeal.seal(tokens.refresh_token),
        historyId: String(profile.historyId),
      });
      accessTokens.set(email, {
        token: tokens.access_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        scope: tokens.scope ?? "",
      });
      await store.upsertMailWatch({ email, vault });
      sendJson(res, 200, { ok: true, email });
      return true;
    }

    // Jeton Google frais tiré du refresh token : la page n'a plus à rouvrir la popup après un rechargement.
    if (path === "/api/push/google-token" && req.method === "GET") {
      const email = (url.searchParams.get("email") ?? "").toLowerCase();
      const grant = tokenSeal && email ? await store.getMailGrant(email) : null;
      // La ligne (email, salon) n'existe qu'après preuve de possession du compte (mail-watch, mail-grant).
      if (!grant || !(await store.listMailWatchVaults(email)).includes(vault)) {
        sendJson(res, 404, { error: "no grant" });
        return true;
      }
      try {
        const { token, expiresAt, scope } = await grantToken(grant);
        sendJson(res, 200, { accessToken: token, expiresIn: Math.floor((expiresAt - Date.now()) / 1000), scope });
      } catch (err) {
        console.warn(`[push] jeton Google côté serveur refusé (${err?.code ?? err?.message ?? err})`);
        sendJson(res, 502, { error: "google refused" });
      }
      return true;
    }

    if (path === "/api/push/subscribe" && req.method === "POST") {
      const body = await readJson(req);
      const deviceId = body?.deviceId;
      const endpoint = body?.subscription?.endpoint;
      const p256dh = body?.subscription?.keys?.p256dh;
      const auth = body?.subscription?.keys?.auth;
      // Le serveur POSTe vers cet endpoint : https seulement.
      if (
        typeof deviceId !== "string" || !deviceId ||
        typeof endpoint !== "string" || !endpoint.startsWith("https://") ||
        typeof p256dh !== "string" || typeof auth !== "string"
      ) {
        sendJson(res, 400, { error: "invalid subscription" });
        return true;
      }
      const label = typeof body?.label === "string" ? body.label.slice(0, 60) : "";
      await store.upsertSubscription({ endpoint, vault, deviceId, p256dh, auth, label });
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/push/devices" && req.method === "GET") {
      const mine = url.searchParams.get("endpoint") ?? "";
      const devices = (await store.listSubscriptions(vault)).map((sub) => ({
        endpoint: sub.endpoint,
        label: sub.label || "Appareil",
        createdAt: Number(sub.createdat),
        lastOkAt: sub.lastokat == null ? null : Number(sub.lastokat),
        mine: sub.endpoint === mine,
      }));
      sendJson(res, 200, { devices });
      return true;
    }

    if (path === "/api/push/schedule" && req.method === "PUT") {
      const body = await readJson(req);
      const deviceId = body?.deviceId;
      const categories = body?.categories;
      if (typeof deviceId !== "string" || !deviceId || !categories || typeof categories !== "object") {
        sendJson(res, 400, { error: "missing deviceId or categories" });
        return true;
      }
      const now = Date.now();
      let accepted = 0;
      for (const category of CATEGORIES) {
        if (!Array.isArray(categories[category])) continue;
        const rows = categories[category]
          .map((item) => cleanRow(category, item, now))
          .filter(Boolean)
          .sort((a, b) => a.fireAt - b.fireAt)
          // ponytail: 200 lignes par catégorie ; au-delà de deux habitudes horaires l'horizon raccourcit, rechargé à l'ouverture de l'app.
          .slice(0, MAX_ROWS);
        await store.replaceSchedule({ vault, deviceId, category, shared: SHARED.has(category) }, rows);
        accepted += rows.length;
      }
      sendJson(res, 200, { ok: true, accepted });
      return true;
    }

    sendJson(res, 404, { error: "unknown push route" });
    return true;
  }

  return { enabled: true, handle };
}
