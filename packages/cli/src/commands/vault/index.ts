import type { Command } from "commander";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SupernoteConfig } from "../../config/index.js";
import { buildConfig, readConfigJson, SUPERNOTE_DIR, CONFIG_JSON } from "../../config/index.js";
import { rpc } from "../../transport/client.js";
import { printError, printSuccess, printTable, defaultOutputOptions } from "../../formatters/index.js";
import chalk from "chalk";

interface VaultOptions {
  json?: boolean;
}

interface VaultInfo {
  path: string;
  name?: string;
  noteCount?: number;
}

export function registerVault(program: Command, getConfig: (vault?: string) => SupernoteConfig): void {
  const vaultCmd = program
    .command("vault")
    .description("Manage Supernote vaults");

  vaultCmd
    .command("list")
    .description("List known vaults")
    .option("--json", "Output as JSON")
    .action(async (opts: VaultOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const config = getConfig();
      const result = await rpc<VaultInfo[]>(config, "vault.list", {});
      if (result.ok) {
        printTable(opts2, result.data.map((v) => ({ path: v.path, name: v.name ?? "", notes: v.noteCount ?? 0 })));
      } else {
        // Offline: show config vault
        const cfg = readConfigJson();
        const vaultPath = cfg.vaultPath ?? cfg.defaultVault ?? "(none configured)";
        if (opts2.json) {
          process.stdout.write(JSON.stringify([{ path: vaultPath }]) + "\n");
        } else {
          process.stdout.write(`Current vault: ${opts2.color ? chalk.cyan(vaultPath) : vaultPath}\n`);
        }
      }
    });

  vaultCmd
    .command("open <path>")
    .description("Set the current vault to <path>")
    .option("--json", "Output as JSON")
    .action(async (vaultPath: string, opts: VaultOptions) => {
      const opts2 = defaultOutputOptions(opts);
      if (!existsSync(vaultPath)) {
        printError(opts2, `Path does not exist: ${vaultPath}`);
        process.exit(1);
      }

      if (!existsSync(SUPERNOTE_DIR)) mkdirSync(SUPERNOTE_DIR, { recursive: true });
      const existing = readConfigJson();
      const updated = { ...existing, vaultPath };
      writeFileSync(CONFIG_JSON, JSON.stringify(updated, null, 2), "utf-8");

      // Also try to notify the running app
      const config = buildConfig(vaultPath);
      await rpc(config, "vault.open", { vaultPath });

      printSuccess(opts2, `Vault set to: ${vaultPath}`);
    });

  vaultCmd
    .command("status")
    .description("Show info about the current vault")
    .option("--json", "Output as JSON")
    .action(async (opts: VaultOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const config = getConfig();
      const result = await rpc<{ path: string; noteCount: number; lastSync?: string }>(
        config,
        "vault.status",
        { vaultPath: config.vaultPath },
      );

      if (result.ok) {
        if (opts2.json) {
          process.stdout.write(JSON.stringify(result.data) + "\n");
        } else {
          const d = result.data;
          process.stdout.write(`Vault path:  ${opts2.color ? chalk.cyan(d.path) : d.path}\n`);
          process.stdout.write(`Notes:       ${d.noteCount}\n`);
          if (d.lastSync) process.stdout.write(`Last sync:   ${d.lastSync}\n`);
        }
      } else {
        // Offline status
        if (opts2.json) {
          process.stdout.write(JSON.stringify({ path: config.vaultPath, offline: true }) + "\n");
        } else {
          process.stdout.write(`Vault path: ${config.vaultPath}\n`);
          process.stderr.write(`Note: App is not running (${result.error})\n`);
        }
      }
    });
}
