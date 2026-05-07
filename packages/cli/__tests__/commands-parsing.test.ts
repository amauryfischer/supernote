import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import type { SupernoteConfig } from "../src/config/index.js";

const makeConfig = (): SupernoteConfig => ({
  vaultPath: "/tmp/vault",
  socketPath: "/tmp/nonexistent.sock",
  runtimeJsonPath: "/tmp/runtime.json",
  configJsonPath: "/tmp/config.json",
});

/** Mutable store — updated by mock implementations. */
const captured: { title?: string; typeId?: string; query?: string; expression?: string } = {};

// Module-level mocks — factories capture from outer scope via the `captured` ref.
vi.mock("../src/transport/client.js", () => ({
  rpc: vi.fn(),
}));

vi.mock("../src/transport/offline.js", () => ({
  writeNoteOffline: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Object.keys(captured).forEach((k) => {
    delete (captured as Record<string, unknown>)[k];
  });
});

function suppressOutput(): void {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

describe("new command — argument parsing", () => {
  it("parses title from positional args", async () => {
    suppressOutput();
    const { rpc } = await import("../src/transport/client.js");
    const { writeNoteOffline } = await import("../src/transport/offline.js");

    vi.mocked(rpc).mockResolvedValue({ ok: false, error: "mock", transport: "offline" });
    vi.mocked(writeNoteOffline).mockImplementation(async (_vault, note) => {
      captured.title = note.title;
      return { ok: true, data: { filePath: "/tmp/vault/Inbox/test.md" }, transport: "offline" };
    });

    const { registerNew } = await import("../src/commands/new.js");
    const program = new Command();
    program.exitOverride();
    registerNew(program, makeConfig);
    await program.parseAsync(["node", "supernote", "new", "My", "Test", "Note"]);
    expect(captured.title).toBe("My Test Note");
  });

  it("parses --type flag", async () => {
    suppressOutput();
    const { rpc } = await import("../src/transport/client.js");
    const { writeNoteOffline } = await import("../src/transport/offline.js");

    vi.mocked(rpc).mockResolvedValue({ ok: false, error: "mock", transport: "offline" });
    vi.mocked(writeNoteOffline).mockImplementation(async (_vault, note) => {
      captured.typeId = note.typeId;
      return { ok: true, data: { filePath: "/tmp/vault/Inbox/test.md" }, transport: "offline" };
    });

    const { registerNew } = await import("../src/commands/new.js");
    const program = new Command();
    program.exitOverride();
    registerNew(program, makeConfig);
    await program.parseAsync(["node", "supernote", "new", "--type", "personne", "--", "Jean Dupont"]);
    expect(captured.typeId).toBe("personne");
  });

  it("exits with code 2 when title is missing", async () => {
    suppressOutput();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error("process.exit called");
    });

    const { rpc } = await import("../src/transport/client.js");
    vi.mocked(rpc).mockResolvedValue({ ok: false, error: "mock", transport: "offline" });

    const { registerNew } = await import("../src/commands/new.js");
    const program = new Command();
    program.exitOverride();
    registerNew(program, makeConfig);

    await expect(program.parseAsync(["node", "supernote", "new"])).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});

describe("search command — argument parsing", () => {
  it("accepts a query string and passes it to rpc", async () => {
    suppressOutput();
    const { rpc } = await import("../src/transport/client.js");

    vi.mocked(rpc).mockImplementation(async (_cfg, _method, params) => {
      captured.query = String((params as Record<string, unknown>)["query"] ?? "");
      return { ok: true, data: [], transport: "socket" };
    });

    const { registerSearch } = await import("../src/commands/search.js");
    const program = new Command();
    program.exitOverride();
    registerSearch(program, makeConfig);
    await program.parseAsync(["node", "supernote", "search", "react hooks"]);
    expect(captured.query).toBe("react hooks");
  });
});

describe("query command — argument parsing", () => {
  it("accepts an expression and calls rpc", async () => {
    suppressOutput();
    const { rpc } = await import("../src/transport/client.js");

    vi.mocked(rpc).mockImplementation(async (_cfg, _method, params) => {
      captured.expression = String((params as Record<string, unknown>)["expression"] ?? "");
      return { ok: true, data: [], transport: "socket" };
    });

    const { registerQuery } = await import("../src/commands/query.js");
    const program = new Command();
    program.exitOverride();
    registerQuery(program, makeConfig);
    await program.parseAsync(["node", "supernote", "query", "type:note tag:client"]);
    expect(captured.expression).toBe("type:note tag:client");
  });
});
