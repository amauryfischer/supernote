import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, map, flatMap, unwrap, unwrapOr } from "./index.js";

describe("Result", () => {
  it("ok() creates a successful result", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  it("err() creates a failure result", () => {
    const r = err("oops");
    expect(r.ok).toBe(false);
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  it("map() transforms Ok value", () => {
    const r = map(ok(2), (v) => v * 3);
    expect(isOk(r) && r.value).toBe(6);
  });

  it("map() passes through Err unchanged", () => {
    const r = map(err("fail"), (v: number) => v * 3);
    expect(isErr(r) && r.error).toBe("fail");
  });

  it("flatMap() chains Ok results", () => {
    const r = flatMap(ok(5), (v) => ok(v + 1));
    expect(isOk(r) && r.value).toBe(6);
  });

  it("flatMap() short-circuits on Err", () => {
    const r = flatMap(err("stop"), (_: number) => ok(99));
    expect(isErr(r) && r.error).toBe("stop");
  });

  it("unwrap() returns value for Ok", () => {
    expect(unwrap(ok("hello"))).toBe("hello");
  });

  it("unwrap() throws for Err", () => {
    expect(() => unwrap(err("bad"))).toThrow();
  });

  it("unwrapOr() returns fallback for Err", () => {
    expect(unwrapOr(err("no"), "default")).toBe("default");
    expect(unwrapOr(ok("yes"), "default")).toBe("yes");
  });
});
