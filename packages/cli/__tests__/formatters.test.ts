import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultOutputOptions, isTTY, printTable, printSuccess, printError } from "../src/formatters/index.js";

describe("defaultOutputOptions", () => {
  it("sets json=true when flag is true", () => {
    const opts = defaultOutputOptions({ json: true });
    expect(opts.json).toBe(true);
    expect(opts.color).toBe(false);
  });

  it("sets json=false when flag is false", () => {
    const opts = defaultOutputOptions({ json: false });
    expect(opts.json).toBe(false);
  });

  it("defaults json to false when undefined", () => {
    const opts = defaultOutputOptions({});
    expect(opts.json).toBe(false);
  });
});

describe("isTTY", () => {
  it("returns boolean", () => {
    expect(typeof isTTY()).toBe("boolean");
  });
});

describe("printTable", () => {
  it("outputs JSON when json=true", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const opts = { json: true, color: false };
    const rows = [{ id: "1", title: "Note A" }];
    printTable(opts, rows);
    const output = spy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain('"id"');
    expect(output).toContain('"Note A"');
    spy.mockRestore();
  });

  it("outputs no-results message for empty array", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const opts = { json: false, color: false };
    printTable(opts, []);
    const output = spy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("no results");
    spy.mockRestore();
  });

  it("renders aligned columns for plain output", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const opts = { json: false, color: false };
    printTable(opts, [
      { id: "123", title: "Hello World" },
      { id: "456", title: "Short" },
    ]);
    const output = spy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("123");
    expect(output).toContain("Hello World");
    spy.mockRestore();
  });
});

describe("printSuccess", () => {
  it("writes JSON when json=true", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printSuccess({ json: true, color: false }, "it worked");
    const output = spy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.message).toBe("it worked");
    spy.mockRestore();
  });

  it("writes plain text when json=false", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printSuccess({ json: false, color: false }, "all good");
    const output = spy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("all good");
    spy.mockRestore();
  });
});

describe("printError", () => {
  it("writes error to stderr as JSON when json=true", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    printError({ json: true, color: false }, "something went wrong");
    const output = spy.mock.calls.map((c) => c[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("something went wrong");
    spy.mockRestore();
  });
});
