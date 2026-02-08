
import { ensureDir } from "std/fs/mod.ts";

export const WASM_PATH = "./sha3_wasm_bg.7b9ca65ddd.wasm";

// Simple logger
export const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  warning: (msg: string) => console.warn(`[WARN] ${msg}`),
  exception: (msg: string) => console.error(`[EXCEPTION] ${msg}`),
};

// Define types
interface Account {
  email?: string;
  mobile?: string;
  password?: string;
  token?: string;
}

interface Config {
  accounts: Account[];
  keys: string[];
  debug: boolean;
}

// Initialize Configuration
export const CONFIG: Config = {
  accounts: [],
  keys: [],
  debug: Deno.env.get("DEBUG") === "true",
};

// Load configuration logic
async function loadConfig() {
  // 1. Try loading from config.json (relative to Deno CWD)
  // We look for config.json in the same directory as deno.json or src/..
  const configPaths = ["./deno/config.json", "./config.json", "../config.json"];
  
  for (const path of configPaths) {
    try {
      const text = await Deno.readTextFile(path);
      const data = JSON.parse(text);
      if (data.accounts && Array.isArray(data.accounts)) {
        CONFIG.accounts = data.accounts.filter((a: any) => (a.email || a.mobile) && (a.password || a.token));
      }
      if (data.keys && Array.isArray(data.keys)) {
        CONFIG.keys = data.keys;
      }
      if (typeof data.debug === 'boolean') {
        CONFIG.debug = data.debug;
      }
      logger.info(`Loaded config from ${path}`);
      break; // Stop after first successful load
    } catch (e) {
      // Ignore missing files
    }
  }

  // 2. Override with Environment Variables (Priority High)
  const envAccounts = Deno.env.get("ACCOUNTS");
  if (envAccounts) {
    try {
      const parsed = JSON.parse(envAccounts);
      if (Array.isArray(parsed)) {
        CONFIG.accounts = parsed;
        logger.info("Loaded accounts from ACCOUNTS env var");
      }
    } catch (e) {
      logger.error(`Failed to parse ACCOUNTS env var: ${e}`);
    }
  }

  const envKeys = Deno.env.get("AUTH_KEYS");
  if (envKeys) {
    try {
      // Try JSON
      const parsed = JSON.parse(envKeys);
      if (Array.isArray(parsed)) CONFIG.keys = parsed;
    } catch {
      // Try comma separated
      CONFIG.keys = envKeys.split(",").map(k => k.trim());
    }
    logger.info("Loaded keys from AUTH_KEYS env var");
  }
}

// Execute load (Top-level await)
await loadConfig();
