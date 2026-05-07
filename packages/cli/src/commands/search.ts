import type { Command } from "commander";
import ora from "ora";
import type { SupernoteConfig } from "../config/index.js";
import { rpc } from "../transport/client.js";
import { printError, printTable, printTransportBadge, defaultOutputOptions } from "../formatters/index.js";

interface SearchResult {
  id: string;
  title: string;
  typeId: string;
  score: number;
  filePath: string;
}

interface SearchOptions {
  vault?: string;
  limit?: string;
  json?: boolean;
}

export function registerSearch(program: Command, getConfig: (vault?: string) => SupernoteConfig): void {
  program
    .command("search <query>")
    .description("Full-text search across all notes")
    .option("-v, --vault <path>", "Override vault path")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query: string, opts: SearchOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const config = getConfig(opts.vault);
      const limit = parseInt(opts.limit ?? "20", 10);
      const spinner = !opts2.json ? ora(`Searching: ${query}`).start() : null;

      const result = await rpc<SearchResult[]>(config, "search.fts", {
        query,
        limit,
        vaultPath: config.vaultPath,
      });

      spinner?.stop();
      if (result.ok) {
        printTransportBadge(opts2, result.transport);
        const rows = result.data.map((r) => ({
          id: r.id,
          type: r.typeId,
          title: r.title,
          score: r.score.toFixed(2),
        }));
        printTable(opts2, rows);
        if (rows.length === 0 && !opts2.json) {
          process.stdout.write("No results found.\n");
        }
      } else {
        printError(opts2, `Search failed: ${result.error}`);
        process.exit(1);
      }
    });
}
