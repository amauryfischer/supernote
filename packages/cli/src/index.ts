#!/usr/bin/env node
import { Command } from "commander";
import { buildConfig } from "./config/index.js";
import { registerNew } from "./commands/new.js";
import { registerSearch } from "./commands/search.js";
import { registerQuery } from "./commands/query.js";
import { registerDaily } from "./commands/daily.js";
import { registerExport } from "./commands/export.js";
import { registerSync } from "./commands/sync.js";
import { registerApi } from "./commands/api.js";
import { registerVault } from "./commands/vault/index.js";
import { registerImport } from "./commands/import/index.js";
import type { SupernoteConfig } from "./config/index.js";

const program = new Command();

program
  .name("supernote")
  .description("Companion CLI for the Supernote personal knowledge + CRM system")
  .version("0.0.0")
  .option("-v, --vault <path>", "Override vault path (also: SUPERNOTE_VAULT env var)")
  .option("--json", "Output as JSON (implies no color)")
  .addHelpText(
    "after",
    `
Environment:
  SUPERNOTE_VAULT   Path to the vault directory (overrides config)

Configuration:
  ~/.supernote/config.json   Persistent vault path
  ~/.supernote/runtime.json  Runtime token + port (written by app)
  ~/.supernote/cli.sock      Unix socket (written by app when running)

Transport (in order of priority):
  1. Unix socket  ~/.supernote/cli.sock
  2. HTTP         127.0.0.1:<port> using token from runtime.json
  3. Offline      Write .md directly to vault root
`,
  );

function getConfig(vault?: string): SupernoteConfig {
  const globalVault = program.opts()["vault"] as string | undefined;
  return buildConfig(vault ?? globalVault);
}

registerNew(program, getConfig);
registerSearch(program, getConfig);
registerQuery(program, getConfig);
registerDaily(program, getConfig);
registerExport(program, getConfig);
registerSync(program, getConfig);
registerApi(program);
registerVault(program, getConfig);
registerImport(program, getConfig);

// Catch unknown commands
program.on("command:*", (operands: string[]) => {
  process.stderr.write(`Unknown command: ${operands.join(" ")}\n`);
  process.stderr.write("Run 'supernote --help' for usage.\n");
  process.exit(2);
});

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
