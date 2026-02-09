
import { ensureDir } from "std/fs/mod.ts";
import { getAccountIdentifier } from "./core/utils.ts";

export const WASM_PATH = "./sha3_wasm_bg.7b9ca65ddd.wasm";

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
  // 3. Load from Deno KV (Persistence)
  try {
    const kv = await Deno.openKv();
    
    // 1. Try V2 Config (Split keys)
    const idsResult = await kv.get(["config", "account_ids"]);
    if (idsResult.value) {
        const ids = idsResult.value as string[];
        const accounts: Account[] = [];
        
        // Load keys
        const keysResult = await kv.get(["config", "keys"]);
        if (keysResult.value) CONFIG.keys = keysResult.value as string[];
        
        // Load accounts in parallel
        const futures = ids.map(id => kv.get(["accounts", id]));
        const results = await Promise.all(futures);
        
        for (const res of results) {
            if (res.value) accounts.push(res.value as Account);
        }
        
        CONFIG.accounts = accounts;
        
        // Load debug
        const debugResult = await kv.get(["config", "debug"]);
        if (debugResult.value !== null) CONFIG.debug = !!debugResult.value;

        logger.info(`Loaded ${accounts.length} accounts from KV (v2)`);
    } else {
        // 2. Fallback to Legacy Config (Single Blob)
        const result = await kv.get(["config"]);
        if (result.value) {
            const kvConfig = result.value as Config;
            // Merge KV config
            if (kvConfig.accounts) CONFIG.accounts = kvConfig.accounts;
            if (kvConfig.keys) CONFIG.keys = kvConfig.keys;
            logger.info("Loaded config from Deno KV (legacy)");
            
            // Auto-migrate to V2
            await saveConfig();
            logger.info("Migrated config to V2 format");
        }
    }
  } catch (e) {
    logger.warning(`Deno KV not available or failed: ${e}`);
  }
}

/**
 * Save current configuration to Deno KV
 * Uses split-key strategy to avoid 64KB limit
 */
export async function saveConfig() {
  try {
    const kv = await Deno.openKv();
    
    // 1. Save Account IDs list
    const accountIds = CONFIG.accounts.map(acc => getAccountIdentifier(acc));
    await kv.set(["config", "account_ids"], accountIds);
    
    // 2. Save individual accounts
    for (const acc of CONFIG.accounts) {
        const id = getAccountIdentifier(acc);
        await kv.set(["accounts", id], acc);
    }
    
    // 3. Save keys
    await kv.set(["config", "keys"], CONFIG.keys);
    
    // 4. Save debug setting
    await kv.set(["config", "debug"], CONFIG.debug);
    
    // Optional: Clean up removed accounts?
    // For now, we don't delete old ["accounts", id] keys to avoid complex diffing logic.
    // They will just be orphaned and not loaded.
    
  } catch (e) {
    logger.error(`Failed to save config to KV: ${e}`);
  }
}

// Execute load (Top-level await)
await loadConfig();
