
import { ensureDir } from "std/fs/mod.ts";

export const CONFIG = {
  accounts: [], // Will be populated from ENV or file
  keys: [],     // Allowed API keys for using internal accounts
  debug: Deno.env.get("DEBUG") === "true",
};

export const WASM_PATH = "./sha3_wasm_bg.7b9ca65ddd.wasm";

// Simple logger
export const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  warning: (msg: string) => console.warn(`[WARN] ${msg}`),
  exception: (msg: string) => console.error(`[EXCEPTION] ${msg}`),
};
