import type { Command } from "commander";
import ora from "ora";
import type { SupernoteConfig } from "../config/index.js";
import { rpc } from "../transport/client.js";
import { printError, printTable, printTransportBadge, defaultOutputOptions } from "../formatters/index.js";

interface QueryResult {
  id: string;
  title: string;
  typeId: string;
  tags?: string[];
  filePath: string;
}

interface QueryOptions {
  vault?: string;
  limit?: string;
  json?: boolean;
}

export function registerQuery(program: Command, getConfig: (vault?: string) => SupernoteConfig): void {
  program
    .command("query <expression>")
    .description("Query notes using the Supernote query language (e.g. type:personne tag:client)")
    .option("-v, --vault <path>", "Override vault path")
    .option("-n, --limit <n>", "Max results", "50")
    .option("--json", "Output as JSON")
    .addHelpText("after", "\nExamples:\n  supernote query 'type:personne tag:client'\n  supernote query 'type:note created:>2024-01-01'")
    .action(async (expression: string, opts: QueryOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const config = getConfig(opts.vault);
      const limit = parseInt(opts.limit ?? "50", 10);
      const spinner = !opts2.json ? ora(`Querying: ${expression}`).start() : null;

      const result = await rpc<QueryResult[]>(config, "search.query", {
        expression,
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
          tags: (r.tags ?? []).join(", "),
        }));
        printTable(opts2, rows);
        if (rows.length === 0 && !opts2.json) {
          process.stdout.write("No results found.\n");
        }
      } else {
        printError(opts2, `Query failed: ${result.error}`);
        process.exit(1);
      }
    });
}
