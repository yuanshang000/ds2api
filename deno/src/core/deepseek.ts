
import {
  DEEPSEEK_LOGIN_URL,
  DEEPSEEK_CREATE_POW_URL,
  BASE_HEADERS,
} from "./constants.ts";
import { logger } from "../config.ts";
import { computePowAnswer } from "./pow.ts";
import { getAccountIdentifier } from "./utils.ts";

export async function loginDeepseekViaAccount(account: any): Promise<string> {
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

    // Update account with new token (in-memory)
    account.token = token;
    return token;
  } catch (e) {
    logger.error(`[Login] Exception: ${e}`);
    throw e;
  }
}

export async function getPowResponse(token: string, maxAttempts = 3): Promise<string | null> {
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
        const headers = { ...BASE_HEADERS, "Authorization": `Bearer ${token}` };
        const resp = await fetch(DEEPSEEK_CREATE_POW_URL, {
            method: "POST",
            headers,
            body: JSON.stringify({ target_path: "/api/v0/chat/completion" }),
        });

        if (!resp.ok) {
            logger.error(`[PoW] Request failed: ${resp.status}`);
            attempts++;
            continue;
        }

        const data = await resp.json();
        if (data.code !== 0) {
            logger.warning(`[PoW] API Error: ${data.msg}`);
            attempts++;
            continue;
        }

        const challenge = data.data.biz_data.challenge;
        const answer = await computePowAnswer(
            challenge.algorithm,
            challenge.challenge,
            challenge.salt,
            challenge.difficulty,
            challenge.expire_at,
            challenge.signature,
            challenge.target_path
        );

        if (answer === null) {
            logger.warning("[PoW] Failed to compute answer, retrying...");
            attempts++;
            continue;
        }

        const powDict = {
            algorithm: challenge.algorithm,
            challenge: challenge.challenge,
            salt: challenge.salt,
            answer: answer,
            signature: challenge.signature,
            target_path: challenge.target_path,
        };

        const powStr = JSON.stringify(powDict);
        return btoa(unescape(encodeURIComponent(powStr))); // Base64 encode utf-8

    } catch (e) {
        logger.error(`[PoW] Exception: ${e}`);
        attempts++;
    }
  }
  return null;
}
