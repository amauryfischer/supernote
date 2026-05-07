import type { Command } from "commander";
import ora from "ora";
import type { SupernoteConfig } from "../config/index.js";
import { rpc } from "../transport/client.js";
import { printError, defaultOutputOptions } from "../formatters/index.js";

type ExportFormat = "md" | "json" | "csv";

interface ExportOptions {
  format?: ExportFormat;
  vault?: string;
  json?: boolean;
}

export function registerExport(program: Command, getConfig: (vault?: string) => SupernoteConfig): void {
  program
    .command("export <type>")
    .description("Export entities of a given type to md, json, or csv")
    .option("-f, --format <fmt>", "Export format: md | json | csv", "json")
    .option("-v, --vault <path>", "Override vault path")
    .option("--json", "Output as JSON (same as --format json)")
    .addHelpText("after", "\nExamples:\n  supernote export personne --format csv > contacts.csv\n  supernote export note --format md > notes.md")
    .action(async (type: string, opts: ExportOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const format: ExportFormat = opts.json ? "json" : (opts.format ?? "json");
      const config = getConfig(opts.vault);
      const spinner = !opts2.json ? ora(`Exporting ${type} as ${format}`).start() : null;

      const result = await rpc<{ content: string }>(config, "export.generate", {
        typeId: type,
        format,
        vaultPath: config.vaultPath,
      });

      spinner?.stop();
      if (result.ok) {
        process.stdout.write(result.data.content);
      } else {
        printError(opts2, `Export failed: ${result.error}`);
        process.exit(1);
      }
    });
}
