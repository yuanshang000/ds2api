
import { Hono } from "hono";
import { logger, CONFIG } from "../config.ts";
import { loginDeepseekViaAccount, getPowResponse } from "../core/deepseek.ts";
import { messagesPrepare } from "../core/messages.ts";
import { DEEPSEEK_COMPLETION_URL, BASE_HEADERS } from "../core/constants.ts";

const router = new Hono();

router.get("/v1/models", (c) => {
    return c.json({
        object: "list",
        data: [
            {
                id: "deepseek-chat",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
            },
            {
                id: "deepseek-reasoner",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
            }
        ]
    });
});

router.post("/v1/chat/completions", async (c) => {
    let body: any;
    try {
        body = await c.req.json();
    } catch (e) {
        return c.json({ error: { message: "Invalid JSON", type: "invalid_request_error" } }, 400);
    }
    
    const { messages, model, stream } = body;

    if (!messages || !model) {
        return c.json({ error: { message: "Missing messages or model", type: "invalid_request_error" } }, 400);
    }

    // Auth logic
    const authHeader = c.req.header("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
         return c.json({ error: { message: "Unauthorized: missing Bearer token.", type: "invalid_request_error" } }, 401);
    }
    const token = authHeader.replace("Bearer ", "").trim();
    
    let deepseekToken = token;
    let useInternalAccount = false;

    // Use keys from CONFIG (already loaded from file or env)
    const configKeys = CONFIG.keys || [];

    if (configKeys.includes(token)) {
        useInternalAccount = true;
        // Use accounts from CONFIG (already loaded from file or env)
        const accounts = CONFIG.accounts || [];

        if (accounts.length === 0) {
             return c.json({ error: { message: "No internal accounts configured.", type: "server_error" } }, 500);
        }

        // Pick account (Round Robin simplified: just pick first valid for now)
        const account = accounts[0]; 
        
        if (!account.token) {
            try {
                await loginDeepseekViaAccount(account);
            } catch (e) {
                 return c.json({ error: { message: "Internal account login failed.", type: "server_error" } }, 500);
            }
        }
        deepseekToken = account.token;
    }

    try {
        // Get PoW
        const pow = await getPowResponse(deepseekToken);
        if (!pow) {
             return c.json({ error: { message: "Failed to calculate PoW", type: "server_error" } }, 500);
        }

        // Prepare payload
        const prompt = messagesPrepare(messages);
        const payload = {
            model: "deepseek_chat", 
            prompt: prompt,
            parent_message_id: null,
            play_ground: false,
            save_chat: false,
            search_enabled: false,
            thinking_enabled: false,
            pow_challenge_response: pow,
            stream: true, 
        };
        
        const headers = {
            ...BASE_HEADERS,
            "Authorization": `Bearer ${deepseekToken}`,
        };

        const response = await fetch(DEEPSEEK_COMPLETION_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const text = await response.text();
            return c.json({ error: { message: `DeepSeek API Error: ${response.status} ${text}`, type: "api_error" } }, response.status);
        }

        // Return stream
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        (async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        await writer.write(encoder.encode("data: [DONE]\n\n"));
                        break;
                    }
                    const chunk = decoder.decode(value, { stream: true });
                    // TODO: Improve SSE transformation
                    await writer.write(encoder.encode(chunk)); 
                }
            } catch (e) {
                logger.error(`Stream error: ${e}`);
                try {
                    await writer.write(encoder.encode(`data: {"error": "${String(e)}"}\n\n`));
                } catch {}
            } finally {
                await writer.close();
            }
        })();

        return new Response(readable, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });

    } catch (e) {
        logger.error(`Chat completion error: ${e}`);
        return c.json({ error: { message: String(e), type: "server_error" } }, 500);
    }
});

export default router;
