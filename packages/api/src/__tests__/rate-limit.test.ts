import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHttpServer } from "../http/server.js";
import { createMockResolvers } from "./mock-resolvers.js";

describe("Rate Limiting", () => {
  let url: string;
  let token: string;
  let server: ReturnType<typeof createHttpServer>;

  beforeEach(async () => {
    server = createHttpServer({ resolvers: createMockResolvers(), port: 0 });
    ({ url, token } = await server.start());
  });

  afterEach(async () => {
    await server.stop();
  });

  it("allows requests under the rate limit", async () => {
    // Make 5 requests — well within the 100/min limit
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${url}/api/v1/health`);
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 after exceeding rate limit from same IP", async () => {
    // Override the limit by making 101+ requests from "127.0.0.1"
    // Since WINDOW_MS is 60s we cannot wait it out — we use X-Forwarded-For to simulate
    const ip = "10.0.0.99";
    const requests = Array.from({ length: 101 }, () =>
      fetch(`${url}/api/v1/health`, { headers: { "x-forwarded-for": ip } })
    );
    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);
    expect(statuses).toContain(429);
  });

  it("Retry-After header is present on 429", async () => {
    const ip = "10.0.0.88";
    const requests = Array.from({ length: 105 }, () =>
      fetch(`${url}/api/v1/health`, { headers: { "x-forwarded-for": ip } })
    );
    const responses = await Promise.all(requests);
    const blocked = responses.find((r) => r.status === 429);
    expect(blocked).toBeDefined();
    expect(blocked!.headers.get("Retry-After")).toBeTruthy();
  });

  it("different IPs have independent limits", async () => {
    const ip1 = "10.1.1.1";
    const ip2 = "10.1.1.2";
    // Exhaust ip1
    await Promise.all(
      Array.from({ length: 101 }, () =>
        fetch(`${url}/api/v1/health`, { headers: { "x-forwarded-for": ip1 } })
      )
    );
    // ip2 should still work
    const res = await fetch(`${url}/api/v1/health`, { headers: { "x-forwarded-for": ip2 } });
    expect(res.status).toBe(200);
  });

  it("auth token still required even under rate limit", async () => {
    const res = await fetch(`${url}/api/v1/entities`);
    expect(res.status).toBe(401);
    const authorized = await fetch(`${url}/api/v1/entities`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authorized.status).toBe(200);
  });
});
