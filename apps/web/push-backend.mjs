import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createPushStore } from "./push-store.mjs";

const CATEGORIES = ["reminder", "event", "followup", "snooze"];
const SHARED = new Set(["reminder", "event"]);
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const MISSED_MS = 15 * 60 * 1000;
const MAX_ROWS = 200;
const MAX_BODY_BYTES = 1024 * 1024;
const TICK_MS = 30_000;
const TTL_S = 15 * 60;
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
  if (!res.ok) throw Object.assign(new Error(`google token ${res.status}`), { code: json?.error });
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
  const accessTokens = new Map(); // email → { token, expiresAt }

  async function grantToken(grant) {
    const cached = accessTokens.get(grant.email);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const refreshToken = tokenSeal.open(grant.refreshtoken);
    try {
      if (!refreshToken) throw Object.assign(new Error("refresh token illisible"), { code: "invalid_grant" });
      const json = await googleOAuthToken({
        client_id: grant.clientid,
        client_secret: googleSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      accessTokens.set(grant.email, { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 });
      return json.access_token;
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
      const token = await grantToken(grant);
      let hist;
      try {
        hist = await gmailApi(
          token,
          `history?startHistoryId=${encodeURIComponent(grant.lasthistoryid)}&historyTypes=messageAdded&labelId=INBOX`,
        );
      } catch (err) {
        if (err?.status !== 404) throw err;
        // startHistoryId trop ancien : on repart de l'état présent, ce push reste générique.
        const profile = await gmailApi(token, "profile");
        await store.setMailGrantHistory(email, String(profile.historyId));
        return null;
      }
      if (hist?.historyId) await store.setMailGrantHistory(email, String(hist.historyId));
      const added = (hist?.history ?? [])
        .flatMap((h) => h.messagesAdded ?? [])
        .map((m) => m.message)
        .filter((m) => m?.labelIds?.includes("INBOX"))
        .slice(0, 5);
      const metas = await Promise.all(
        added.map((m) => gmailApi(token, `messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)),
      );
      const inbox = await gmailApi(token, "labels/INBOX");
      const header = (m, name) => m.payload?.headers?.find((h) => h.name === name)?.value ?? "";
      return {
        items: metas.map((m) => ({
          from: senderName(header(m, "From")).slice(0, 80),
          subject: header(m, "Subject").slice(0, 160),
          threadId: String(m.threadId ?? ""),
        })),
        badge: inbox?.threadsUnread ?? inbox?.messagesUnread ?? 0,
      };
    } catch (err) {
      console.warn(`[push] lecture Gmail côté serveur échouée (${err?.message ?? err})`);
      return null;
    }
  }

  // Le watch Gmail expire au bout de 7 jours : sans ça il dépendrait d'une page ouverte dans la semaine.
  async function renewWatches() {
    for (const grant of await store.listStaleMailGrants(Date.now() - WATCH_RENEW_MS)) {
      try {
        const token = await grantToken(grant);
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

  async function deliver(sub, payload, topic) {
    try {
      // urgency high : Android en veille diffère les messages « normal ».
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: TTL_S, topic, urgency: "high" },
      );
      await store.markSubscriptionOk(sub.endpoint);
    } catch (err) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        await store.removeSubscription(sub.endpoint);
        console.log(`[push] abonnement expiré retiré (${status})`);
      } else {
        console.warn(`[push] envoi refusé (${status ?? err})`);
      }
    }
  }

  // Une rafale Pub/Sub (lecture, archivage, plusieurs arrivées) ne fait qu'un push par fenêtre.
  // Clé par adresse : la lecture Gmail avance lasthistoryid, un second salon du même compte recevrait une liste vide.
  const mailPending = new Map(); // email → { lastSentAt, timer, historyId }

  async function sendMail(email, historyId) {
    const detail = tokenSeal ? await detailedMail(email) : null;
    const payload = JSON.stringify({
      kind: "mail", title: "Nouveau mail", body: "", url: "/mail", tag: "mail-new", historyId, email, ...detail,
    });
    let count = 0;
    for (const vault of await store.listMailWatchVaults(email)) {
      const subs = await store.listSubscriptions(vault);
      count += subs.length;
      await Promise.all(subs.map((sub) => deliver(sub, payload, topicOf(`mail:${email}`))));
    }
    console.log(`[push] mail → ${count} abonnement(s)${detail ? " (détaillé)" : ""}`);
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
        const subs = subsByVault.get(row.vault);
        const payload = JSON.stringify({
          title: row.title,
          body: row.body,
          url: row.url,
          tag: row.key,
          joinUrl: row.joinurl,
        });
        await Promise.all(subs.map((sub) => deliver(sub, payload, topicOf(row.key))));
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
        console.warn(`[push] mail-grant : échange du code refusé par Google (${err?.code ?? err?.message ?? "?"})`);
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
      accessTokens.set(email, { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 });
      await store.upsertMailWatch({ email, vault });
      sendJson(res, 200, { ok: true, email });
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
      await store.upsertSubscription({ endpoint, vault, deviceId, p256dh, auth });
      sendJson(res, 200, { ok: true });
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
