import { fuzzyScore } from "./fuzzy";
import type { Command, CommandRegistry } from "./types";

class CommandRegistryImpl implements CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(cmd: Command): () => void {
    this.commands.set(cmd.id, cmd);
    return () => this.unregister(cmd.id);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  list(): Command[] {
    return Array.from(this.commands.values()).filter(
      (cmd) => cmd.when === undefined || cmd.when(),
    );
  }

  search(query: string): Command[] {
    const candidates = this.list();
    if (!query.trim()) return candidates;

    const scored = candidates
      .map((cmd) => ({
        cmd,
        score: fuzzyScore(query, cmd.label, cmd.keywords ?? []),
      }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score);

    return scored.map(({ cmd }) => cmd);
  }

  async execute(id: string): Promise<void> {
    const cmd = this.commands.get(id);
    if (!cmd) {
      console.warn(`[CommandRegistry] Unknown command: "${id}"`);
      return;
    }
    if (cmd.when && !cmd.when()) {
      console.warn(`[CommandRegistry] Command "${id}" is not currently available`);
      return;
    }
    await cmd.run();
  }
}

/** Singleton registry — available on both server and client (tree-shaken on server if unused). */
export const registry: CommandRegistry = new CommandRegistryImpl();
