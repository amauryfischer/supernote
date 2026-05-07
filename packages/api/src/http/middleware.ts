import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

// ---- Auth middleware ----------------------------------------

export function createAuthMiddleware(token: string) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.req.header("Authorization");
    if (!auth || auth !== `Bearer ${token}`) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    await next();
  };
}

// ---- Rate limit middleware ----------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

export function createRateLimitMiddleware() {
  const store = new Map<string, RateLimitEntry>();

  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = c.req.header("x-forwarded-for") ?? "unknown";
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now >= entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    } else {
      entry.count++;
      if (entry.count > MAX_REQUESTS) {
        c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
        throw new HTTPException(429, { message: "Too Many Requests" });
      }
    }

    await next();
  };
}

// ---- CORS middleware (Electron / file:// only) -------------

export function createCorsMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const origin = c.req.header("Origin") ?? "";
    const allowed = origin === "" || origin === "null" || origin.startsWith("file://");

    if (allowed) {
      c.header("Access-Control-Allow-Origin", origin || "*");
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    }

    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    await next();
  };
}
