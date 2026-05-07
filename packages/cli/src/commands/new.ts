import type { Command } from "commander";
import ora from "ora";
import { ulid } from "ulid";
import type { SupernoteConfig } from "../config/index.js";
import { rpc } from "../transport/client.js";
import { writeNoteOffline } from "../transport/offline.js";
import { printSuccess, printError, printTransportBadge, defaultOutputOptions } from "../formatters/index.js";

interface NewOptions {
  type?: string;
  vault?: string;
  json?: boolean;
}

export function registerNew(program: Command, getConfig: (vault?: string) => SupernoteConfig): void {
  program
    .command("new [title...]")
    .description("Create a new note in the Inbox (default) or a typed entity")
    .option("-t, --type <typeId>", "Entity type (e.g. personne, contact)")
    .option("-v, --vault <path>", "Override vault path")
    .option("--json", "Output as JSON")
    .addHelpText("after", "\nExamples:\n  supernote new \"Meeting notes\"\n  supernote new -t personne -- \"Jean Dupont\"")
    .action(async (titleParts: string[], opts: NewOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const title = titleParts.join(" ").trim();
      if (!title) {
        printError(opts2, "Title is required. Usage: supernote new \"<title>\"");
        process.exit(2);
      }

      const config = getConfig(opts.vault);
      const id = ulid();
      const typeId = opts.type ?? "note";
      const spinner = !opts2.json ? ora(`Creating ${typeId}: ${title}`).start() : null;

      const result = await rpc<{ id: string; filePath: string }>(config, "notes.create", {
        id,
        title,
        typeId,
        vaultPath: config.vaultPath,
      });

      if (result.ok) {
        spinner?.succeed(`Created: ${result.data.filePath}`);
        printTransportBadge(opts2, result.transport);
        printSuccess(opts2, `${typeId} "${title}" created (id: ${result.data.id})`);
      } else {
        // Offline fallback
        if (spinner) spinner.text = "App offline — writing directly to vault";
        const offline = await writeNoteOffline(config.vaultPath, { id, title, typeId });
        spinner?.stop();
        if (offline.ok) {
          printWarning(opts2, "App not running — note written offline: " + offline.data.filePath);
          printTransportBadge(opts2, "offline");
          if (opts2.json) {
            process.stdout.write(JSON.stringify({ ok: true, id, filePath: offline.data.filePath, offline: true }) + "\n");
          }
        } else {
          spinner?.fail("Failed");
          printError(opts2, offline.error);
          process.exit(1);
        }
      }
    });
}

function printWarning(opts2: ReturnType<typeof defaultOutputOptions>, message: string): void {
  if (opts2.json) return;
  process.stderr.write("WARN: " + message + "\n");
}
