import type { Command } from "commander";
import ora from "ora";
import type { SupernoteConfig } from "../config/index.js";
import { rpc } from "../transport/client.js";
import { writeNoteOffline } from "../transport/offline.js";
import { ulid } from "ulid";
import { printError, printSuccess, printTransportBadge, defaultOutputOptions } from "../formatters/index.js";

interface DailyOptions {
  vault?: string;
  json?: boolean;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerDaily(program: Command, getConfig: (vault?: string) => SupernoteConfig): void {
  program
    .command("daily")
    .description("Open or create the daily note for today")
    .option("-v, --vault <path>", "Override vault path")
    .option("--json", "Output as JSON")
    .action(async (opts: DailyOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const config = getConfig(opts.vault);
      const date = todayDate();
      const title = `Daily — ${date}`;
      const spinner = !opts2.json ? ora(`Opening daily note for ${date}`).start() : null;

      const result = await rpc<{ id: string; filePath: string; created: boolean }>(
        config,
        "notes.daily",
        { date, vaultPath: config.vaultPath },
      );

      spinner?.stop();
      if (result.ok) {
        printTransportBadge(opts2, result.transport);
        const action = result.data.created ? "Created" : "Opened";
        printSuccess(opts2, `${action} daily note: ${result.data.filePath}`);
      } else {
        // Offline fallback — create the file directly
        if (spinner) spinner.text = "App offline — writing daily note offline";
        const offline = await writeNoteOffline(config.vaultPath, {
          id: ulid(),
          title,
          typeId: "daily",
          body: `# ${title}\n\n`,
        });
        spinner?.stop();
        if (offline.ok) {
          printSuccess(opts2, `Daily note written offline: ${offline.data.filePath}`);
        } else {
          printError(opts2, offline.error);
          process.exit(1);
        }
      }
    });
}
