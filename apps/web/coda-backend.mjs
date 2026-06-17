/**
 * Read-only Coda proxy for the Supernote importer.
 *
 * Mounted by `server.mjs` under `/api/coda/*` only when `CODA_API_TOKEN` is set
 * (mirrors the optional `sync-backend.mjs` mount). It exists for two reasons the
 * browser can't solve itself:
 *   1. CORS — the Coda API does not send permissive CORS headers, so a direct
 *      browser fetch to coda.io is blocked. Same-origin `/api/coda/*` is not.
 *   2. Secrecy — the Coda token grants full read access to the user's workspace.
 *      It lives in the server env and is NEVER sent to the client; the client
 *      only ever talks to its own origin.
 *
 * The proxy is a strict read-only allowlist: only the four GET endpoints the
 * importer needs are forwarded, query string passed through verbatim. A
 * token-bucket throttle keeps us under Coda's documented read limits
 * (100 req / 6 s overall, 4 req / 6 s for listing docs) and relays `Retry-After`
 * on 429 so the client can back off.
 */

const CODA_BASE = "https://coda.io/apis/v1";
const PREFIX = "/api/coda/";

// Subpaths (after the prefix, query stripped) we are willing to forward. The
// remainder maps 1:1 onto the Coda path, so we just prepend CODA_BASE.
const ALLOW = [
  /^docs$/,
  /^docs\/[^/]+\/tables$/,
  /^docs\/[^/]+\/tables\/[^/]+\/columns$/,
  /^docs\/[^/]+\/tables\/[^/]+\/rows$/,
];

/**
 * Minimal token-bucket limiter. `capacity` tokens refill over `windowMs`;
 * acquire() resolves as soon as a token is free, queueing FIFO otherwise.
 */
function createBucket(capacity, windowMs) {
  let tokens = capacity;
  const refillPerMs = capacity / windowMs;
  let last = Date.now();
  const queue = [];

  function refill() {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + (now - last) * refillPerMs);
    last = now;
  }
  function pump() {
    refill();
    while (queue.length > 0 && tokens >= 1) {
      tokens -= 1;
      queue.shift()();
    }
    if (queue.length > 0) {
      // Time until the next whole token is available.
      const wait = Math.ceil((1 - tokens) / refillPerMs);
      setTimeout(pump, Math.max(15, wait));
    }
  }
  return function acquire() {
    return new Promise((resolve) => {
      queue.push(resolve);
      pump();
    });
  };
}

export async function createCodaBackend() {
  const token = process.env.CODA_API_TOKEN;
  if (!token) return { enabled: false, handle: () => false };

  // Overall read budget, plus a stricter bucket for the heavier `GET /docs`.
  const readBucket = createBucket(90, 6000);
  const listDocsBucket = createBucket(3, 6000);

  function cors(res, extra = {}) {
    res.writeHead(extra.status ?? 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store",
      ...extra.headers,
    });
  }
  function sendJson(res, status, body, headers) {
    cors(res, { status, headers });
    res.end(JSON.stringify(body));
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    if (!path.startsWith(PREFIX)) return false;

    if (req.method === "OPTIONS") {
      cors(res, { status: 204 });
      res.end();
      return true;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method not allowed" });
      return true;
    }

    const sub = path.slice(PREFIX.length);

    // Lets the client know the connector is wired without exposing the token.
    if (sub === "status") {
      sendJson(res, 200, { enabled: true });
      return true;
    }

    if (!ALLOW.some((re) => re.test(sub))) {
      sendJson(res, 404, { error: "unknown coda route" });
      return true;
    }

    const bucket = sub === "docs" ? listDocsBucket : readBucket;
    await bucket();

    const target = `${CODA_BASE}/${sub}${url.search}`;
    try {
      const upstream = await fetch(target, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const text = await upstream.text();
      const headers = {};
      const retryAfter = upstream.headers.get("retry-after");
      if (retryAfter) headers["Retry-After"] = retryAfter;
      cors(res, { status: upstream.status, headers });
      res.end(text);
    } catch (err) {
      console.error("[coda] upstream fetch failed:", err);
      sendJson(res, 502, { error: "coda upstream unreachable" });
    }
    return true;
  }

  console.log("[coda] read-only importer proxy ENABLED at /api/coda/*");
  return { enabled: true, handle };
}
