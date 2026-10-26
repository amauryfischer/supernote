/**
 * `GET /api/unfurl?url=` — titre d'une page web, pour transformer une URL collée en lien titré.
 *
 * Sans dépendance (Node 22). Le serveur fait une requête sortante pour le compte d'un
 * visiteur anonyme : tout le fichier est organisé autour de la garde SSRF.
 *  - http/https seulement, pas d'identifiants, ports 80/443 seulement ;
 *  - le nom est résolu ici, TOUTES les adresses doivent être publiques, puis la
 *    connexion est forcée sur l'IP validée (anti DNS-rebinding) ;
 *  - 3 redirections au plus, chacune revalidée de bout en bout ;
 *  - délai total 5 s, corps lu jusqu'à 200 Ko, text/html uniquement ;
 *  - le corps distant n'est jamais renvoyé, seulement le titre extrait.
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 200 * 1024;
const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

class UnfurlError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function parseIPv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function isPublicIPv4([a, b, c]) {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a >= 224) return false; // multicast + réservé + broadcast
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, métadonnées cloud
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIPv6(ip) {
  let text = ip;
  if (text.includes(".")) {
    const cut = text.lastIndexOf(":");
    const v4 = parseIPv4(text.slice(cut + 1));
    if (!v4) return null;
    text = `${text.slice(0, cut + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

function isPublicIPv6(b) {
  const zeros = (from, to) => b.slice(from, to).every((x) => x === 0);
  // ::ffff:a.b.c.d (IPv4 mappée) et 64:ff9b::a.b.c.d (NAT64) : on juge l'IPv4 embarquée.
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPublicIPv4(b.slice(12));
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return isPublicIPv4(b.slice(12));
  if (b[0] === 0x20 && b[1] === 0x02) return isPublicIPv4(b.slice(2, 6)); // 6to4
  if (b[0] < 0x20 || b[0] > 0x3f) return false; // hors 2000::/3 : ::1, ::, fc00::/7, fe80::/10, ff00::/8…
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] <= 0x01) return false; // 2001::/23 (Teredo, protocoles IETF)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // documentation
  if (b[0] === 0x3f && b[1] === 0xff && (b[2] & 0xf0) === 0) return false; // documentation
  return true;
}

/** Vrai seulement pour une adresse IP unicast routable sur Internet. */
export function isPublicAddress(ip) {
  if (typeof ip !== "string") return false;
  const family = net.isIP(ip);
  if (family === 4) return isPublicIPv4(parseIPv4(ip) ?? [0, 0, 0, 0]);
  if (family === 6) {
    const bytes = parseIPv6(ip);
    return bytes !== null && isPublicIPv6(bytes);
  }
  return false;
}

/** Valide l'URL puis résout son nom : renvoie l'URL parsée et l'IP validée sur laquelle se connecter. */
async function validateTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UnfurlError(400, "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnfurlError(400, "invalid_url");
  if (url.username || url.password) throw new UnfurlError(400, "invalid_url");
  if (url.port !== "" && url.port !== "80" && url.port !== "443") throw new UnfurlError(403, "blocked");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new UnfurlError(403, "blocked");
    return { url, address: host, family: net.isIP(host) };
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnfurlError(502, "unreachable");
  }
  if (addresses.length === 0) throw new UnfurlError(502, "unreachable");
  if (!addresses.every((a) => isPublicAddress(a.address))) throw new UnfurlError(403, "blocked");
  return { url, address: addresses[0].address, family: addresses[0].family };
}

/** GET unique, sans suivre les redirections. Corps tronqué à MAX_BODY_BYTES. */
function fetchOnce({ url, address, family }, signal) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        signal,
        // Connexion imposée sur l'IP déjà validée : une seconde résolution DNS ne peut plus rediriger vers une adresse interne.
        lookup: (_host, opts, cb) => (opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; SupernoteBot/1.0; +link-title)",
          accept: "text/html,application/xhtml+xml;q=0.9",
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: String(res.headers.location) });
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new UnfurlError(502, "upstream_status"));
          return;
        }
        const type = String(res.headers["content-type"] ?? "");
        const encoding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
        if (!/^text\/html\b/i.test(type)) {
          res.resume();
          reject(new UnfurlError(415, "not_html"));
          return;
        }
        if (encoding !== "identity") {
          res.resume();
          reject(new UnfurlError(502, "upstream_encoding"));
          return;
        }
        const chunks = [];
        let size = 0;
        const finish = () => resolve({ body: Buffer.concat(chunks), contentType: type });
        res.on("data", (chunk) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_BODY_BYTES) {
            res.destroy();
            finish();
          }
        });
        res.on("end", finish);
        res.on("error", () => (size > 0 ? finish() : reject(new UnfurlError(502, "unreachable"))));
      },
    );
    req.on("error", (err) => reject(err instanceof UnfurlError ? err : new UnfurlError(502, "unreachable")));
    req.end();
  });
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", copy: "©", reg: "®",
  trade: "™", middot: "·", bull: "•", euro: "€", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç",
};

function decodeEntities(text) {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]{1,8}));/gi, (match, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    try {
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    } catch {
      return match;
    }
  });
}

function decodeBody(body, contentType) {
  const header = /charset=["']?([\w.:-]+)/i.exec(contentType)?.[1];
  const sniffed = /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1];
  for (const label of [header, sniffed]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      /* label inconnu : essai suivant */
    }
  }
  return new TextDecoder("utf-8").decode(body);
}

function attribute(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** `og:title` d'abord, sinon `<title>` ; entités décodées, espaces normalisés, 200 caractères au plus. */
export function extractTitle(html) {
  let raw;
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name"))?.toLowerCase();
    const content = attribute(tag, "content");
    if (key === "og:title" && content?.trim()) {
      raw = content;
      break;
    }
  }
  raw ??= /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (!raw) return null;
  // eslint-disable-next-line no-control-regex
  const title = decodeEntities(raw).replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, MAX_TITLE_LENGTH).trim();
  return title || null;
}

/** Titre de la page à `rawUrl`, ou UnfurlError. Toute la chaîne de redirections passe par la garde. */
export async function fetchTitle(rawUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await validateTarget(current);
      const result = await fetchOnce(target, controller.signal);
      if (result.redirect === undefined) {
        const title = extractTitle(decodeBody(result.body, result.contentType));
        if (!title) throw new UnfurlError(404, "no_title");
        return title;
      }
      try {
        current = new URL(result.redirect, target.url).href;
      } catch {
        throw new UnfurlError(502, "bad_redirect");
      }
    }
    throw new UnfurlError(502, "too_many_redirects");
  } catch (err) {
    if (controller.signal.aborted) throw new UnfurlError(504, "timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const hits = new Map();

function clientIp(req) {
  // Derrière le routeur Scalingo, la dernière entrée de X-Forwarded-For est celle qu'il a ajoutée (les précédentes sont falsifiables).
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").pop()?.trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": status === 200 ? "private, max-age=86400" : "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/** Handler partagé par server.mjs et le serveur de dev Vite. Renvoie true si la requête était pour /api/unfurl. */
export async function handleUnfurl(req, res) {
  const parsed = new URL(req.url ?? "/", "http://localhost");
  if (parsed.pathname !== "/api/unfurl") return false;
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
    return true;
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    sendJson(res, 403, { error: "forbidden" });
    return true;
  }
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { error: "rate_limited" }, { "Retry-After": "60" });
    return true;
  }
  const target = parsed.searchParams.get("url");
  if (!target || target.length > MAX_URL_LENGTH) {
    sendJson(res, 400, { error: "invalid_url" });
    return true;
  }
  try {
    sendJson(res, 200, { title: await fetchTitle(target) });
  } catch (err) {
    if (err instanceof UnfurlError) sendJson(res, err.status, { error: err.code });
    else sendJson(res, 500, { error: "internal" });
  }
  return true;
}
