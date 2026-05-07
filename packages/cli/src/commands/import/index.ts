import type { Command } from "commander";
import ora from "ora";
import type { SupernoteConfig } from "../../config/index.js";
import { rpc } from "../../transport/client.js";
import { printError, printSuccess, printTransportBadge, defaultOutputOptions } from "../../formatters/index.js";

interface ImportOptions {
  vault?: string;
  json?: boolean;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

export function registerImport(program: Command, getConfig: (vault?: string) => SupernoteConfig): void {
  const importCmd = program
    .command("import")
    .description("Import notes from external sources");

  importCmd
    .command("notion <zip>")
    .description("Import from a Notion export ZIP file")
    .option("-v, --vault <path>", "Override vault path")
    .option("--json", "Output as JSON")
    .action(async (zipPath: string, opts: ImportOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const config = getConfig(opts.vault);
      const spinner = !opts2.json ? ora(`Importing from Notion: ${zipPath}`).start() : null;

      const result = await rpc<ImportResult>(config, "import.notion", {
        zipPath,
        vaultPath: config.vaultPath,
      });

      spinner?.stop();
      if (result.ok) {
        printTransportBadge(opts2, result.transport);
        const { imported, skipped, errors } = result.data;
        printSuccess(opts2, `Imported ${imported} notes (${skipped} skipped, ${errors} errors)`);
      } else {
        printError(opts2, `Notion import failed: ${result.error}`);
        process.exit(1);
      }
    });

  importCmd
    .command("obsidian <vault-path>")
    .description("Import from an Obsidian vault directory")
    .option("-v, --vault <path>", "Override Supernote vault path")
    .option("--json", "Output as JSON")
    .action(async (obsidianPath: string, opts: ImportOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const config = getConfig(opts.vault);
      const spinner = !opts2.json ? ora(`Importing from Obsidian: ${obsidianPath}`).start() : null;

      const result = await rpc<ImportResult>(config, "import.obsidian", {
        obsidianPath,
        vaultPath: config.vaultPath,
      });

      spinner?.stop();
      if (result.ok) {
        printTransportBadge(opts2, result.transport);
        const { imported, skipped, errors } = result.data;
        printSuccess(opts2, `Imported ${imported} notes (${skipped} skipped, ${errors} errors)`);
      } else {
        printError(opts2, `Obsidian import failed: ${result.error}`);
        process.exit(1);
      }
    });
}
