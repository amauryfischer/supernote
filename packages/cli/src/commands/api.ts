import type { Command } from "commander";
import { readRuntimeJson } from "../config/index.js";
import { printError, defaultOutputOptions } from "../formatters/index.js";
import chalk from "chalk";

interface ApiOptions {
  json?: boolean;
}

export function registerApi(program: Command): void {
  const apiCmd = program
    .command("api")
    .description("API token management");

  apiCmd
    .command("token")
    .description("Display current HTTP API token")
    .option("--json", "Output as JSON")
    .action((opts: ApiOptions) => {
      const opts2 = defaultOutputOptions(opts);
      const runtime = readRuntimeJson();
      if (!runtime.token) {
        printError(opts2, "No token found — is the app running?");
        process.exit(1);
      }
      if (opts2.json) {
        process.stdout.write(JSON.stringify({ token: runtime.token, port: runtime.port }) + "\n");
      } else {
        const tokenDisplay = opts2.color ? chalk.cyan(runtime.token) : runtime.token;
        process.stdout.write(`Token: ${tokenDisplay}\n`);
        if (runtime.port) {
          process.stdout.write(`Port:  ${runtime.port}\n`);
        }
      }
    });
}
