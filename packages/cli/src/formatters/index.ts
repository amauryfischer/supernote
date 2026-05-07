import chalk from "chalk";

export interface OutputOptions {
  json: boolean;
  color: boolean;
}

/** Detect if stdout is a TTY (colorize output). */
export function isTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function defaultOutputOptions(flags: { json?: boolean }): OutputOptions {
  return {
    json: flags.json ?? false,
    color: !flags.json && isTTY(),
  };
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function printSuccess(opts: OutputOptions, message: string): void {
  if (opts.json) {
    printJson({ ok: true, message });
    return;
  }
  process.stdout.write((opts.color ? chalk.green("✓ ") : "OK: ") + message + "\n");
}

export function printError(opts: OutputOptions, message: string): void {
  if (opts.json) {
    process.stderr.write(JSON.stringify({ ok: false, error: message }) + "\n");
    return;
  }
  process.stderr.write((opts.color ? chalk.red("✗ ") : "ERR: ") + message + "\n");
}

export function printWarning(opts: OutputOptions, message: string): void {
  if (opts.json) return; // suppress in JSON mode
  process.stderr.write((opts.color ? chalk.yellow("⚠ ") : "WARN: ") + message + "\n");
}

export function printTable(
  opts: OutputOptions,
  rows: Record<string, unknown>[],
): void {
  if (opts.json) {
    printJson(rows);
    return;
  }
  if (rows.length === 0) {
    process.stdout.write("(no results)\n");
    return;
  }
  const keys = Object.keys(rows[0] ?? {});
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)),
  );

  const header = keys.map((k, i) => k.padEnd(widths[i] ?? k.length)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  process.stdout.write(
    (opts.color ? chalk.bold(header) : header) + "\n" + separator + "\n",
  );
  for (const row of rows) {
    const line = keys
      .map((k, i) => String(row[k] ?? "").padEnd(widths[i] ?? 0))
      .join("  ");
    process.stdout.write(line + "\n");
  }
}

export function printTransportBadge(
  opts: OutputOptions,
  transport: string,
): void {
  if (opts.json || !opts.color) return;
  const badge =
    transport === "socket"
      ? chalk.cyan("[socket]")
      : transport === "http"
        ? chalk.blue("[http]")
        : chalk.magenta("[offline]");
  process.stderr.write(badge + "\n");
}
