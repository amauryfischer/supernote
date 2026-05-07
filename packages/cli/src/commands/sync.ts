import type { Command } from "commander";
import ora from "ora";
import type { SupernoteConfig } from "../config/index.js";
import { rpc } from "../transport/client.js";
import { printError, printSuccess, printTransportBadge, defaultOutputOptions } from "../formatters/index.js";

interface SyncOptions {
  vault?: string;
  message?: string;
  json?: boolean;
}

export function registerSync(program: Command, getConfig: (vault?: string) => SupernoteConfig): void {
  program
    .command("sync")
    .description("Git commit and push all vault changes")
    .option("-v, --vault <path>", "Override vault path")
    .option("-m, --message <msg>", "Commit message", `sync: ${new Date().toISOString().slice(0, 10)}`)
    .option("--json", "Output as JSON")
    .action(async (opts: SyncOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const config = getConfig(opts.vault);
      const spinner = !opts2.json ? ora("Syncing vault...").start() : null;

      const result = await rpc<{ commit: string; pushed: boolean }>(config, "git.sync", {
        vaultPath: config.vaultPath,
        message: opts.message,
      });

      spinner?.stop();
      if (result.ok) {
        printTransportBadge(opts2, result.transport);
        const pushed = result.data.pushed ? " (pushed)" : " (committed only)";
        printSuccess(opts2, `Synced: ${result.data.commit}${pushed}`);
      } else {
        printError(opts2, `Sync failed: ${result.error}`);
        process.exit(1);
      }
    });
}
