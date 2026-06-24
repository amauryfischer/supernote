import { describe, it, expect } from "vitest";
import { __isTokenFresh, type CachedToken } from "./google-drive";

const base: CachedToken = {
  accessToken: "tok",
  expiresAt: Date.now() + 600_000,
  clientId: "cid",
  scope: "scopeA",
};

describe("__isTokenFresh", () => {
  it("matches on clientId AND scope", () => {
    expect(__isTokenFresh(base, "cid", "scopeA")).toBe(true);
    expect(__isTokenFresh(base, "cid", "scopeB")).toBe(false);
    expect(__isTokenFresh(base, "other", "scopeA")).toBe(false);
  });
  it("rejects expired tokens (60s margin)", () => {
    expect(__isTokenFresh({ ...base, expiresAt: Date.now() + 10_000 }, "cid", "scopeA")).toBe(false);
    expect(__isTokenFresh(null, "cid", "scopeA")).toBe(false);
  });
});
