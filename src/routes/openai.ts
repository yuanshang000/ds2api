
import { Hono } from "hono";
import { logger, CONFIG } from "../config.ts";
import { loginDeepseekViaAccount, getPowResponse } from "../core/deepseek.ts";
import { messagesPrepare } from "../core/messages.ts";
import { DEEPSEEK_COMPLETION_URL, BASE_HEADERS } from "../core/constants.ts";
import { parseSseChunkForContent, parseDeepseekSseLine } from "../core/sse_parser.ts";

import { getAccountIdentifier } from "../core/utils.ts";

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

        let account = null;
        
        // Check for X-DS-Account-ID header for specific account selection
        const specificAccountId = c.req.header("X-DS-Account-ID");
        if (specificAccountId) {
            account = accounts.find(a => getAccountIdentifier(a) === specificAccountId);
            if (!account) {
                // Fallback to pool if specific account not found? Or error?
                // For now, let's log warning and fallback to pool
                logger.warning(`Requested account ${specificAccountId} not found, falling back to pool`);
            } else {
                logger.info(`Using specific account: ${getAccountIdentifier(account)}`);
            }
        }

        // If no specific account or not found, use Round Robin
        if (!account) {
            const randomIndex = Math.floor(Math.random() * accounts.length);
            account = accounts[randomIndex];
            logger.info(`Using random account: ${getAccountIdentifier(account)}`);
        }
        
        if (!account.token) {
            try {
                const token = await loginDeepseekViaAccount(account);
                account.token = token;
                // Update KV asynchronously to persist the token
                (async () => {
                    try {
                        const kv = await Deno.openKv();
                        await kv.set(["config"], CONFIG);
                    } catch {}
                })();
            } catch (e) {
                 return c.json({ error: { message: `Internal account login failed: ${e}`, type: "server_error" } }, 500);
            }
        }
        deepseekToken = account.token;
    }

    try {
        // Create Chat Session first (Required by DeepSeek API)
        const sessionHeaders = {
            ...BASE_HEADERS,
            "Authorization": `Bearer ${deepseekToken}`,
        };
        logger.info("Creating chat session...");
        const sessionResp = await fetch("https://chat.deepseek.com/api/v0/chat_session/create", {
            method: "POST",
            headers: sessionHeaders,
            body: JSON.stringify({ agent: "chat" }),
        });
        
        let chatSessionId = null;
        if (sessionResp.ok) {
            const sessionData = await sessionResp.json();
            chatSessionId = sessionData.data?.biz_data?.id;
            logger.info(`Chat session created: ${chatSessionId}`);
        } else {
            // If session creation fails, we might still try, but it's risky
            const text = await sessionResp.text();
            logger.warning(`Failed to create chat session: ${sessionResp.status} ${text}`);
        }

        // Get PoW
        logger.info("Calculating PoW...");
        const pow = await getPowResponse(deepseekToken);
        if (!pow) {
             logger.error("Failed to calculate PoW");
             return c.json({ error: { message: "Failed to calculate PoW", type: "server_error" } }, 500);
        }
        logger.info("PoW calculated successfully");

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
            stream: true, 
            chat_session_id: chatSessionId, // Add session ID
            ref_file_ids: [], // Required by DeepSeek API
        };
        
        const headers = {
            ...BASE_HEADERS,
            "Authorization": `Bearer ${deepseekToken}`,
            "x-ds-pow-response": pow, // Add PoW header
        };

        logger.info("Sending completion request...");
        const response = await fetch(DEEPSEEK_COMPLETION_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const text = await response.text();
            logger.error(`DeepSeek API Error: ${response.status} ${text}`);
            console.error(`DeepSeek API Error Body: ${text}`); // Force stdout
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
            let currentFragmentType = "thinking"; // Default start
            const thinkingEnabled = true; // Assume true for parsing logic

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        if (stream) {
                            await writer.write(encoder.encode("data: [DONE]\n\n"));
                        }
                        break;
                    }
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split("\n");
                    
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.startsWith("data:")) continue;
                        
                        const sseChunk = parseDeepseekSseLine(trimmed);
                        if (!sseChunk) continue;
                        if (sseChunk.type === "done") continue;

                        const { contents, isFinished, newFragmentType } = parseSseChunkForContent(
                            sseChunk, 
                            thinkingEnabled, 
                            currentFragmentType
                        );
                        currentFragmentType = newFragmentType;

                        if (contents.length > 0) {
                            for (const [content, type] of contents) {
                                if (stream) {
                                    const openaiChunk = {
                                        id: "chatcmpl-" + Math.random().toString(36).substring(7),
                                        object: "chat.completion.chunk",
                                        created: Math.floor(Date.now() / 1000),
                                        model: model,
                                        choices: [{
                                            index: 0,
                                            delta: {
                                                [type === "thinking" ? "reasoning_content" : "content"]: content
                                            },
                                            finish_reason: null
                                        }]
                                    };
                                    await writer.write(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
                                } else {
                                    // Handle non-stream accumulation (not implemented fully in this snippet)
                                }
                            }
                        }
                        
                        if (isFinished && stream) {
                             const finishChunk = {
                                id: "chatcmpl-" + Math.random().toString(36).substring(7),
                                object: "chat.completion.chunk",
                                created: Math.floor(Date.now() / 1000),
                                model: model,
                                choices: [{
                                    index: 0,
                                    delta: {},
                                    finish_reason: "stop"
                                }]
                            };
                            await writer.write(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
                        }
                    }
                }
            } catch (e) {
                logger.error(`Stream error: ${e}`);
                try {
                    if (stream) {
                        await writer.write(encoder.encode(`data: {"error": "${String(e)}"}\n\n`));
                    }
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
        console.error(e); // Force stdout
        return c.json({ error: { message: String(e), type: "server_error" } }, 500);
    }
});

export default router;
