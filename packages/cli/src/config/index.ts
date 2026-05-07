import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

export interface SupernoteConfig {
  vaultPath: string;
  apiToken?: string;
  socketPath: string;
  runtimeJsonPath: string;
  configJsonPath: string;
}

export interface RuntimeJson {
  token?: string;
  port?: number;
  pid?: number;
}

export interface ConfigJson {
  vaultPath?: string;
  defaultVault?: string;
}

const SUPERNOTE_DIR = join(homedir(), ".supernote");
const CONFIG_JSON = join(SUPERNOTE_DIR, "config.json");
const RUNTIME_JSON = join(SUPERNOTE_DIR, "runtime.json");
const CLI_SOCK = join(SUPERNOTE_DIR, "cli.sock");

export function readConfigJson(): ConfigJson {
  if (!existsSync(CONFIG_JSON)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_JSON, "utf-8")) as ConfigJson;
  } catch {
    return {};
  }
}

export function readRuntimeJson(): RuntimeJson {
  if (!existsSync(RUNTIME_JSON)) return {};
  try {
    return JSON.parse(readFileSync(RUNTIME_JSON, "utf-8")) as RuntimeJson;
  } catch {
    return {};
  }
}

export function resolveVaultPath(flagVault?: string): string {
  if (flagVault) return flagVault;
  if (process.env["SUPERNOTE_VAULT"]) return process.env["SUPERNOTE_VAULT"];
  const cfg = readConfigJson();
  if (cfg.vaultPath) return cfg.vaultPath;
  if (cfg.defaultVault) return cfg.defaultVault;
  return join(homedir(), "supernote-vault");
}

export function buildConfig(flagVault?: string): SupernoteConfig {
  const runtime = readRuntimeJson();
  return {
    vaultPath: resolveVaultPath(flagVault),
    apiToken: runtime.token,
    socketPath: CLI_SOCK,
    runtimeJsonPath: RUNTIME_JSON,
    configJsonPath: CONFIG_JSON,
  };
}

export { SUPERNOTE_DIR, CONFIG_JSON, RUNTIME_JSON, CLI_SOCK };
