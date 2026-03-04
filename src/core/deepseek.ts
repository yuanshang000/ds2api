
import {
  DEEPSEEK_LOGIN_URL,
  DEEPSEEK_CREATE_POW_URL,
  DEEPSEEK_CREATE_SESSION_URL,
  BASE_HEADERS,
} from "./constants.ts";
import { logger, CONFIG, updateAccountInKV } from "../config.ts";
import { computePowAnswer } from "./pow.ts";
import { getAccountIdentifier } from "./utils.ts";

interface Account {
  email?: string;
  mobile?: string;
  password?: string;
  token?: string;
}

export interface AuthContext {
  token: string;
  usePool: boolean;
  account?: Account | null;
  failedAccounts: Set<string>;
  preferredAccountId?: string;
  release: () => Promise<void>;
  rotate: () => Promise<boolean>;
}

const activeCounts = new Map<string, number>();

function getAccounts(): Account[] {
  return CONFIG.accounts || [];
}

function recordAcquire(account: Account) {
  const id = getAccountIdentifier(account);
  if (!id) return;
  const current = activeCounts.get(id) ?? 0;
  activeCounts.set(id, current + 1);
}

function recordRelease(account?: Account | null) {
  if (!account) return;
  const id = getAccountIdentifier(account);
  if (!id) return;
  const current = activeCounts.get(id) ?? 0;
  if (current <= 1) {
    activeCounts.delete(id);
  } else {
    activeCounts.set(id, current - 1);
  }
}

function pickAccount(excludeIds?: Set<string>, preferredId?: string): Account | null {
  const accounts = getAccounts();
  if (!accounts.length) return null;

  if (preferredId) {
    const match = accounts.find((acc) => getAccountIdentifier(acc) === preferredId);
    if (match) {
      recordAcquire(match);
      return match;
    }
  }

  const excluded = excludeIds ? new Set(excludeIds) : new Set<string>();
  const candidates = accounts.filter((acc) => !excluded.has(getAccountIdentifier(acc)));
  const pool = candidates.length ? candidates : accounts;
  const selected = pool[Math.floor(Math.random() * pool.length)];
  recordAcquire(selected);
  return selected;
}

export function getPoolStatus() {
  const total = getAccounts().length;
  const busyIds = new Set(activeCounts.keys());
  const inUse = busyIds.size;
  const activeSessions = Array.from(activeCounts.values()).reduce((sum, value) => sum + value, 0);
  const available = Math.max(0, total - inUse);
  return {
    total,
    available,
    in_use: inUse,
    active_sessions: activeSessions,
    max_accounts: total,
  };
}

export async function loginDeepseekViaAccount(account: Account): Promise<string> {
  const email = (account.email || "").trim();
  const mobile = (account.mobile || "").trim();
  const password = (account.password || "").trim();

  if (!password || (!email && !mobile)) {
    throw new Error("Missing login info (email/mobile + password)");
  }

  let payload: any;
  if (email) {
    payload = {
      email,
      password,
      device_id: "deepseek_to_api",
      os: "android",
    };
  } else {
    payload = {
      mobile,
      area_code: null,
      password,
      device_id: "deepseek_to_api",
      os: "android",
    };
  }

  try {
    const resp = await fetch(DEEPSEEK_LOGIN_URL, {
      method: "POST",
      headers: BASE_HEADERS,
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error(`[Login] Request failed: ${resp.status} ${text}`);
      throw new Error(`Login failed: ${resp.status}`);
    }

    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`API Error: ${data.msg}`);
    }

    const bizCode = data.data?.biz_code;
    if (bizCode !== 0) {
      throw new Error(`Biz Error: ${data.data?.biz_msg}`);
    }

    const token = data.data?.biz_data?.user?.token;
    if (!token) {
      throw new Error("No token in response");
    }

    account.token = token;
    await updateAccountInKV(account);
    return token;
  } catch (e) {
    logger.error(`[Login] Exception: ${e}`);
    throw e;
  }
}

async function ensureAccountToken(account: Account): Promise<string> {
  if (!account.token) {
    const token = await loginDeepseekViaAccount(account);
    account.token = token;
  }
  return account.token || "";
}

export function generateClientStreamId(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${datePart}-${randomPart}`;
}

export async function determineModeAndToken(headers: Headers): Promise<AuthContext> {
  let callerKey = (headers.get("X-OA-Key") || "").trim();
  if (!callerKey) {
    const authHeader = (headers.get("Authorization") || "").trim();
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      callerKey = authHeader.slice(7).trim();
    }
  }

  if (!callerKey) {
    const err: any = new Error("Unauthorized: missing X-OA-Key or Authorization header.");
    err.status = 401;
    throw err;
  }

  const configKeys = CONFIG.keys || [];
  if (!configKeys.includes(callerKey)) {
    return {
      token: callerKey,
      usePool: false,
      account: null,
      failedAccounts: new Set(),
      release: async () => {},
      rotate: async () => false,
    };
  }

  const preferredAccountId = (headers.get("X-DS-Account-ID") || "").trim() || undefined;
  const failedAccounts = new Set<string>();

  const account = pickAccount(failedAccounts, preferredAccountId);
  if (!account) {
    const err: any = new Error("No accounts available in pool.");
    err.status = 429;
    throw err;
  }

  try {
    await ensureAccountToken(account);
  } catch (e) {
    if (preferredAccountId) {
      recordRelease(account);
      throw e;
    }

    recordRelease(account);
    failedAccounts.add(getAccountIdentifier(account));
    const fallback = pickAccount(failedAccounts, preferredAccountId);
    if (!fallback) throw e;
    try {
      await ensureAccountToken(fallback);
    } catch (err) {
      recordRelease(fallback);
      throw err;
    }
    const fallbackCtx: AuthContext = {
      token: fallback.token || "",
      usePool: true,
      account: fallback,
      failedAccounts,
      preferredAccountId,
      release: async () => {
        if (fallbackCtx.account) {
          recordRelease(fallbackCtx.account);
          fallbackCtx.account = null;
        }
      },
      rotate: async () => false,
    };
    return fallbackCtx;
  }

  const ctx: AuthContext = {
    token: account.token || "",
    usePool: true,
    account,
    failedAccounts,
    preferredAccountId,
    release: async () => {
      if (ctx.account) {
        recordRelease(ctx.account);
        ctx.account = null;
      }
    },
    rotate: async () => {
      if (!ctx.usePool) return false;
      if (ctx.preferredAccountId) return false;
      if (ctx.account) {
        failedAccounts.add(getAccountIdentifier(ctx.account));
        recordRelease(ctx.account);
      }
      const next = pickAccount(failedAccounts, ctx.preferredAccountId);
      if (!next) {
        ctx.account = null;
        ctx.token = "";
        return false;
      }
      await ensureAccountToken(next);
      ctx.account = next;
      ctx.token = next.token || "";
      return true;
    },
  };

  return ctx;
}

export function getAuthHeaders(ctxOrToken: AuthContext | string): Record<string, string> {
  const token = typeof ctxOrToken === "string" ? ctxOrToken : ctxOrToken.token;
  return { ...BASE_HEADERS, "Authorization": `Bearer ${token}` };
}

const powCache = new Map<string, { encoded: string; expireAt: number }>();
const POW_CACHE_MAX = 256;

function makePowCacheKey(challenge: any): string | null {
  if (!challenge || typeof challenge !== "object") return null;
  const parts = [
    challenge.algorithm,
    challenge.challenge,
    challenge.salt,
    challenge.signature,
    challenge.target_path,
  ].map((value) => String(value || ""));
  if (parts.every((part) => !part)) return null;
  return parts.join("|");
}

function getCachedPow(challenge: any): string | null {
  const key = makePowCacheKey(challenge);
  if (!key) return null;
  const entry = powCache.get(key);
  if (!entry) return null;
  const now = Date.now() / 1000;
  if (entry.expireAt <= now) {
    powCache.delete(key);
    return null;
  }
  return entry.encoded;
}

function setCachedPow(challenge: any, encoded: string, expireAt: number) {
  const key = makePowCacheKey(challenge);
  if (!key) return;
  const ttl = Number(expireAt || 0) - 0.5;
  if (ttl <= Date.now() / 1000) return;
  powCache.set(key, { encoded, expireAt: ttl });
  if (powCache.size > POW_CACHE_MAX) {
    const firstKey = powCache.keys().next().value;
    if (firstKey) powCache.delete(firstKey);
  }
}

export async function createSession(ctx: AuthContext, maxAttempts = 3): Promise<string | null> {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      const resp = await fetch(DEEPSEEK_CREATE_SESSION_URL, {
        method: "POST",
        headers: getAuthHeaders(ctx),
        body: JSON.stringify({ agent: "chat" }),
      });

      let data: any = {};
      try {
        data = await resp.json();
      } catch (e) {
        logger.error(`[createSession] JSON parse error: ${e}`);
      }

      if (resp.ok && data?.code === 0) {
        return data?.data?.biz_data?.id || null;
      }

      logger.warning(`[createSession] Failed: ${resp.status} code=${data?.code} msg=${data?.msg}`);
    } catch (e) {
      logger.error(`[createSession] Exception: ${e}`);
    }

    if (ctx.usePool) {
      const rotated = await ctx.rotate();
      if (!rotated) break;
    }
    attempts++;
  }

  return null;
}

export async function getPowResponse(ctx: AuthContext, maxAttempts = 3): Promise<string | null> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const resp = await fetch(DEEPSEEK_CREATE_POW_URL, {
        method: "POST",
        headers: getAuthHeaders(ctx),
        body: JSON.stringify({ target_path: "/api/v0/chat/completion" }),
      });

      if (!resp.ok) {
        logger.error(`[PoW] Request failed: ${resp.status}`);
        attempts++;
        if (ctx.usePool) {
          const rotated = await ctx.rotate();
          if (!rotated) return null;
        }
        continue;
      }

      const data = await resp.json();
      if (data.code !== 0) {
        logger.warning(`[PoW] API Error: ${data.msg}`);
        attempts++;
        if (ctx.usePool) {
          const rotated = await ctx.rotate();
          if (!rotated) return null;
        }
        continue;
      }

      const challenge = data.data?.biz_data?.challenge;
      const cached = getCachedPow(challenge);
      if (cached) return cached;

      const difficulty = challenge?.difficulty ?? 144000;
      const expireAt = challenge?.expire_at ?? 0;
      const answer = await computePowAnswer(
        challenge?.algorithm,
        challenge?.challenge,
        challenge?.salt,
        difficulty,
        expireAt,
        challenge?.signature || "",
        challenge?.target_path || "",
      );

      if (answer === null) {
        logger.warning("[PoW] Failed to compute answer, retrying...");
        attempts++;
        continue;
      }

      const powDict = {
        algorithm: challenge?.algorithm,
        challenge: challenge?.challenge,
        salt: challenge?.salt,
        answer,
        signature: challenge?.signature,
        target_path: challenge?.target_path,
      };

      const powStr = JSON.stringify(powDict);
      const encoded = btoa(unescape(encodeURIComponent(powStr)));
      setCachedPow(challenge, encoded, expireAt);
      return encoded;
    } catch (e) {
      logger.error(`[PoW] Exception: ${e}`);
      attempts++;
      if (ctx.usePool) {
        const rotated = await ctx.rotate();
        if (!rotated) return null;
      }
    }
  }

  return null;
}
