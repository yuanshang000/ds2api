
import { Hono } from "hono";
import { logger, CONFIG } from "../config.ts";
import {
    determineModeAndToken,
    createSession,
    getPowResponse,
    generateClientStreamId,
    getAuthHeaders,
    getPoolStatus,
} from "../core/deepseek.ts";
import { messagesPrepare } from "../core/messages.ts";
import { DEEPSEEK_COMPLETION_URL } from "../core/constants.ts";
import { parseSseChunkForContent, parseDeepseekSseLine } from "../core/sse_parser.ts";
import { estimateTokens } from "../core/utils.ts";

const router = new Hono();

const CLAUDE_MODELS = [
    {
        id: "claude-sonnet-4-20250514",
        object: "model",
        created: 1715635200,
        owned_by: "anthropic",
    },
    {
        id: "claude-sonnet-4-20250514-fast",
        object: "model",
        created: 1715635200,
        owned_by: "anthropic",
    },
    {
        id: "claude-sonnet-4-20250514-slow",
        object: "model",
        created: 1715635200,
        owned_by: "anthropic",
    },
];

function normalizeClaudeMessages(messages: any[]): any[] {
    const normalized: any[] = [];
    for (const message of messages || []) {
        const normalizedMessage = { ...message };
        const content = message?.content;
        if (Array.isArray(content)) {
            const contentParts: string[] = [];
            for (const block of content) {
                if (block?.type === "text" && "text" in block) {
                    contentParts.push(String(block.text || ""));
                } else if (block?.type === "tool_result") {
                    if ("content" in block) {
                        contentParts.push(String(block.content || ""));
                    }
                }
            }
            if (contentParts.length > 0) {
                normalizedMessage.content = contentParts.join("\n");
            } else if (content.length > 0) {
                normalizedMessage.content = content;
            } else {
                normalizedMessage.content = "";
            }
        }
        normalized.push(normalizedMessage);
    }
    return normalized;
}

function buildToolSystemMessage(toolsRequested: any[]): any | null {
    if (!toolsRequested || toolsRequested.length === 0) return null;

    const toolSchemas: string[] = [];
    for (const tool of toolsRequested) {
        const toolName = tool?.name || "unknown";
        const toolDesc = tool?.description || "No description available";
        const schema = tool?.input_schema || {};
        let toolInfo = `Tool: ${toolName}\nDescription: ${toolDesc}`;

        if (schema && typeof schema === "object" && schema.properties) {
            const props: string[] = [];
            const required = schema.required || [];
            for (const [propName, propInfo] of Object.entries(schema.properties)) {
                const propType = (propInfo as any)?.type || "string";
                const isReq = required.includes(propName) ? " (required)" : "";
                props.push(`  - ${propName}: ${propType}${isReq}`);
            }
            if (props.length) {
                toolInfo += `\nParameters:\n${props.join("\n")}`;
            }
        }
        toolSchemas.push(toolInfo);
    }

    return {
        role: "system",
        content: `You are Claude, a helpful AI assistant. You have access to these tools:\n\n${toolSchemas.join("\n")}` +
            `\n\nWhen you need to use tools, output ONLY valid JSON in this format:\n` +
            `{"tool_calls": [{"name": "tool_name", "input": {"param": "value"}}]}\n\n` +
            `You can call multiple tools in ONE response by including them in the same tool_calls array.\n` +
            `Do not include any text outside the JSON structure.`,
    };
}

function convertClaudeToDeepseek(claudeRequest: any): any {
    const messages = claudeRequest?.messages || [];
    const model = claudeRequest?.model || "claude-sonnet-4-20250514";
    const mapping = (CONFIG as any)?.claude_model_mapping || { fast: "deepseek-chat", slow: "deepseek-chat" };
    const modelLower = String(model).toLowerCase();
    const useSlow = modelLower.includes("opus") || modelLower.includes("reasoner") || modelLower.includes("slow");
    const deepseekModel = useSlow ? (mapping.slow || "deepseek-chat") : (mapping.fast || "deepseek-chat");

    const deepseekRequest: any = {
        model: deepseekModel,
        messages: [...messages],
    };

    if (claudeRequest?.system) {
        deepseekRequest.messages = [{ role: "system", content: claudeRequest.system }, ...deepseekRequest.messages];
    }

    if (claudeRequest?.temperature !== undefined) deepseekRequest.temperature = claudeRequest.temperature;
    if (claudeRequest?.top_p !== undefined) deepseekRequest.top_p = claudeRequest.top_p;
    if (claudeRequest?.stop_sequences) deepseekRequest.stop = claudeRequest.stop_sequences;
    if (claudeRequest?.stream !== undefined) deepseekRequest.stream = claudeRequest.stream;

    return deepseekRequest;
}

function detectToolCalls(responseText: string, toolsRequested: any[]): Array<{ name: string; input: any }> {
    if (!toolsRequested || toolsRequested.length === 0) return [];
    const cleaned = String(responseText || "").trim();
    if (!cleaned.startsWith('{"tool_calls":') || !cleaned.endsWith("]}")) return [];

    try {
        const parsed = JSON.parse(cleaned);
        const toolNames = new Set(toolsRequested.map((tool: any) => tool?.name).filter(Boolean));
        const calls = parsed?.tool_calls || [];
        const detected: Array<{ name: string; input: any }> = [];
        for (const call of calls) {
            const toolName = call?.name;
            if (toolName && toolNames.has(toolName)) {
                detected.push({ name: toolName, input: call?.input || {} });
            }
        }
        return detected;
    } catch {
        return [];
    }
}

function estimateClaudeInputTokens(systemText: string, messages: any[], toolsRequested: any[]): number {
    let tokens = 0;
    if (systemText) tokens += estimateTokens(systemText);

    for (const message of messages || []) {
        tokens += 2;
        const content = message?.content ?? "";
        if (Array.isArray(content)) {
            for (const block of content) {
                if (block && typeof block === "object") {
                    if (block.type === "text") {
                        tokens += estimateTokens(block.text || "");
                    } else if (block.type === "tool_result") {
                        tokens += estimateTokens(block.content || "");
                    } else {
                        tokens += estimateTokens(String(block));
                    }
                } else {
                    tokens += estimateTokens(String(block));
                }
            }
        } else {
            tokens += estimateTokens(content);
        }
    }

    for (const tool of toolsRequested || []) {
        tokens += estimateTokens(tool?.name || "");
        tokens += estimateTokens(tool?.description || "");
        tokens += estimateTokens(JSON.stringify(tool?.input_schema || {}));
    }

    return Math.max(1, tokens);
}

router.get("/v1/models", (c) => {
    return c.json({
        object: "list",
        data: [
            {
                id: "deepseek-chat",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
                permission: [],
            },
            {
                id: "deepseek-reasoner",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
                permission: [],
            },
            {
                id: "deepseek-v3",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
                permission: [],
            },
            {
                id: "deepseek-r1",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
                permission: [],
            },
            {
                id: "deepseek-chat-search",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
                permission: [],
            },
            {
                id: "deepseek-reasoner-search",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
                permission: [],
            },
            {
                id: "deepseek-v3-search",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
                permission: [],
            },
            {
                id: "deepseek-r1-search",
                object: "model",
                created: 1677610602,
                owned_by: "deepseek",
                permission: [],
            },
        ]
    });
});

router.get("/anthropic/v1/models", (c) => {
    return c.json({ object: "list", data: CLAUDE_MODELS });
});

router.post("/anthropic/v1/messages", async (c) => {
    let body: any;
    try {
        body = await c.req.json();
    } catch (e) {
        return c.json({ error: { type: "invalid_request_error", message: "Invalid JSON" } }, 400);
    }

    const model = body?.model;
    const messages = body?.messages || [];
    if (!model || !messages) {
        return c.json({ error: { type: "invalid_request_error", message: "Request must include 'model' and 'messages'." } }, 400);
    }

    let authCtx;
    let releaseOnFinally = true;
    try {
        authCtx = await determineModeAndToken(c.req.raw.headers);
    } catch (e: any) {
        const status = e?.status || 401;
        return c.json({ error: { type: "invalid_request_error", message: String(e.message || e) } }, status);
    }

    try {
        const normalizedMessages = normalizeClaudeMessages(messages);
        const toolsRequested = body?.tools || [];
        const hasTools = toolsRequested.length > 0;

        const payload: any = { ...body, messages: [...normalizedMessages] };
        if (hasTools && !payload.messages.some((m: any) => m?.role === "system")) {
            const systemMessage = buildToolSystemMessage(toolsRequested);
            if (systemMessage) payload.messages.unshift(systemMessage);
        }

        const deepseekPayload = convertClaudeToDeepseek(payload);
        const modelLower = String(deepseekPayload?.model || "").toLowerCase();
        let thinkingEnabled = false;
        let searchEnabled = false;

        if (modelLower === "deepseek-v3" || modelLower === "deepseek-chat") {
            thinkingEnabled = false;
            searchEnabled = false;
        } else if (modelLower === "deepseek-r1" || modelLower === "deepseek-reasoner") {
            thinkingEnabled = true;
            searchEnabled = false;
        } else if (modelLower === "deepseek-v3-search" || modelLower === "deepseek-chat-search") {
            thinkingEnabled = false;
            searchEnabled = true;
        } else if (modelLower === "deepseek-r1-search" || modelLower === "deepseek-reasoner-search") {
            thinkingEnabled = true;
            searchEnabled = true;
        }

        if (body?.thinking?.type === "disabled") {
            thinkingEnabled = false;
        }

        const finalPrompt = messagesPrepare(deepseekPayload.messages || []);

        const sessionId = await createSession(authCtx);
        if (!sessionId) {
            return c.json({ error: { type: "invalid_request_error", message: "invalid token." } }, 401);
        }

        const powResp = await getPowResponse(authCtx);
        if (!powResp) {
            return c.json({ error: { type: "api_error", message: "Failed to get PoW." } }, 401);
        }

        const headers = { ...getAuthHeaders(authCtx), "x-ds-pow-response": powResp };
        const payloadDs = {
            chat_session_id: sessionId,
            parent_message_id: null,
            client_stream_id: generateClientStreamId(),
            prompt: finalPrompt,
            ref_file_ids: [],
            thinking_enabled: thinkingEnabled,
            search_enabled: searchEnabled,
            stream: !!body?.stream,
        };

        if (body?.stream) {
            const response = await fetch(DEEPSEEK_COMPLETION_URL, {
                method: "POST",
                headers,
                body: JSON.stringify(payloadDs),
            });

            if (!response.ok) {
                const text = await response.text();
                logger.error(`DeepSeek API Error: ${response.status} ${text}`);
                return c.json({ error: { type: "api_error", message: `DeepSeek API Error: ${response.status} ${text}` } }, response.status);
            }

            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();
            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response body");

            releaseOnFinally = false;
            (async () => {
                let fullResponseText = "";
                let currentFragmentType = "thinking";
                let responseCompleted = false;
                const messageId = `msg_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
                const inputTokens = estimateClaudeInputTokens(body?.system || "", normalizedMessages, toolsRequested);

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split("\n");

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith("data:")) continue;

                            const sseChunk = parseDeepseekSseLine(trimmed);
                            if (!sseChunk || sseChunk.type === "done") continue;

                            const { contents, isFinished, newFragmentType } = parseSseChunkForContent(
                                sseChunk,
                                thinkingEnabled,
                                currentFragmentType
                            );
                            currentFragmentType = newFragmentType;

                            for (const [content, type] of contents) {
                                if (searchEnabled && content.startsWith("[citation:")) continue;
                                if (type === "thinking" && !thinkingEnabled) continue;
                                fullResponseText += content;
                            }

                            if (isFinished) {
                                responseCompleted = true;
                                break;
                            }
                        }
                        if (responseCompleted) break;
                    }

                    const messageStart = {
                        type: "message_start",
                        message: {
                            id: messageId,
                            type: "message",
                            role: "assistant",
                            model,
                            content: [],
                            stop_reason: null,
                            stop_sequence: null,
                            usage: { input_tokens: inputTokens, output_tokens: 0 },
                        },
                    };
                    await writer.write(encoder.encode(`data: ${JSON.stringify(messageStart)}\n\n`));

                    const detectedTools = detectToolCalls(fullResponseText, toolsRequested);
                    let outputTokens = 0;

                    if (detectedTools.length > 0) {
                        let contentIndex = 0;
                        for (const toolInfo of detectedTools) {
                            const toolUseId = `toolu_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}_${contentIndex}`;
                            await writer.write(encoder.encode(`data: ${JSON.stringify({
                                type: "content_block_start",
                                index: contentIndex,
                                content_block: {
                                    type: "tool_use",
                                    id: toolUseId,
                                    name: toolInfo.name,
                                    input: toolInfo.input,
                                },
                            })}\n\n`));
                            await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "content_block_stop", index: contentIndex })}\n\n`));
                            outputTokens += estimateTokens(JSON.stringify(toolInfo.input || {}));
                            contentIndex += 1;
                        }
                        const messageDelta = {
                            type: "message_delta",
                            delta: { stop_reason: "tool_use", stop_sequence: null },
                            usage: { output_tokens: outputTokens },
                        };
                        await writer.write(encoder.encode(`data: ${JSON.stringify(messageDelta)}\n\n`));
                        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`));
                        return;
                    }

                    if (fullResponseText) {
                        await writer.write(encoder.encode(`data: ${JSON.stringify({
                            type: "content_block_start",
                            index: 0,
                            content_block: { type: "text", text: "" },
                        })}\n\n`));
                        await writer.write(encoder.encode(`data: ${JSON.stringify({
                            type: "content_block_delta",
                            index: 0,
                            delta: { type: "text_delta", text: fullResponseText },
                        })}\n\n`));
                        await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`));
                        outputTokens += estimateTokens(fullResponseText);
                    }

                    const messageDelta = {
                        type: "message_delta",
                        delta: { stop_reason: "end_turn", stop_sequence: null },
                        usage: { output_tokens: outputTokens },
                    };
                    await writer.write(encoder.encode(`data: ${JSON.stringify(messageDelta)}\n\n`));
                    await writer.write(encoder.encode(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`));
                } catch (e) {
                    logger.error(`claude stream error: ${e}`);
                    await writer.write(encoder.encode(`data: ${JSON.stringify({
                        type: "error",
                        error: { type: "api_error", message: `Stream processing error: ${String(e)}` },
                    })}\n\n`));
                } finally {
                    await authCtx.release();
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
        }

        const response = await fetch(DEEPSEEK_COMPLETION_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(payloadDs),
        });

        if (!response.ok) {
            const text = await response.text();
            logger.error(`DeepSeek API Error: ${response.status} ${text}`);
            return c.json({ error: { type: "api_error", message: `DeepSeek API Error: ${response.status} ${text}` } }, response.status);
        }

        const decoder = new TextDecoder();
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        let finalContent = "";
        let finalReasoning = "";
        let currentFragmentType = "thinking";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) continue;

                const sseChunk = parseDeepseekSseLine(trimmed);
                if (!sseChunk || sseChunk.type === "done") continue;

                const { contents, isFinished, newFragmentType } = parseSseChunkForContent(
                    sseChunk,
                    thinkingEnabled,
                    currentFragmentType
                );
                currentFragmentType = newFragmentType;

                for (const [content, type] of contents) {
                    if (searchEnabled && content.startsWith("[citation:")) continue;
                    if (type === "thinking") {
                        if (thinkingEnabled) finalReasoning += content;
                    } else {
                        finalContent += content;
                    }
                }

                if (isFinished) break;
            }
        }

        const detectedTools = detectToolCalls(finalContent, toolsRequested);
        let outputTokens = estimateTokens(finalContent) + estimateTokens(finalReasoning);
        if (detectedTools.length > 0) {
            outputTokens = detectedTools.reduce((sum, tool) => sum + estimateTokens(JSON.stringify(tool.input || {})), 0);
        }
        const inputTokens = estimateClaudeInputTokens(body?.system || "", normalizedMessages, toolsRequested);

        const responseContent: any[] = [];
        if (finalReasoning) {
            responseContent.push({ type: "thinking", thinking: finalReasoning });
        }

        if (detectedTools.length > 0) {
            detectedTools.forEach((toolInfo, index) => {
                responseContent.push({
                    type: "tool_use",
                    id: `toolu_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}_${index}`,
                    name: toolInfo.name,
                    input: toolInfo.input,
                });
            });
        } else if (finalContent || !finalReasoning) {
            responseContent.push({
                type: "text",
                text: finalContent || "抱歉，没有生成有效的响应内容。",
            });
        }

        return c.json({
            id: `msg_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`,
            type: "message",
            role: "assistant",
            model,
            content: responseContent,
            stop_reason: detectedTools.length > 0 ? "tool_use" : "end_turn",
            stop_sequence: null,
            usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
            },
        });
    } catch (e) {
        logger.error(`claude_messages error: ${e}`);
        return c.json({ error: { type: "api_error", message: "Internal Server Error" } }, 500);
    } finally {
        if (authCtx && releaseOnFinally) {
            await authCtx.release();
        }
    }
});

router.post("/anthropic/v1/messages/count_tokens", async (c) => {
    let body: any;
    try {
        body = await c.req.json();
    } catch (e) {
        return c.json({ error: { type: "invalid_request_error", message: "Invalid JSON" } }, 400);
    }

    const model = body?.model;
    const messages = body?.messages || [];
    if (!model || !messages) {
        return c.json({ error: { type: "invalid_request_error", message: "Request must include 'model' and 'messages'." } }, 400);
    }

    let authCtx;
    try {
        authCtx = await determineModeAndToken(c.req.raw.headers);
    } catch (e: any) {
        const status = e?.status || 401;
        return c.json({ error: { type: "invalid_request_error", message: String(e.message || e) } }, status);
    }

    try {
        const inputTokens = estimateClaudeInputTokens(body?.system || "", messages, body?.tools || []);
        return c.json({ input_tokens: inputTokens });
    } finally {
        if (authCtx) {
            await authCtx.release();
        }
    }
});

router.get("/pool/status", (c) => {
    return c.json(getPoolStatus());
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

    let authCtx;
    try {
        authCtx = await determineModeAndToken(c.req.raw.headers);
    } catch (e: any) {
        const status = e?.status || 401;
        return c.json({ error: { message: String(e.message || e), type: "invalid_request_error" } }, status);
    }

    try {
        const modelLower = String(model).toLowerCase();
        let thinkingEnabled = false;
        let searchEnabled = false;

        if (modelLower === "deepseek-v3" || modelLower === "deepseek-chat") {
            thinkingEnabled = false;
            searchEnabled = false;
        } else if (modelLower === "deepseek-r1" || modelLower === "deepseek-reasoner") {
            thinkingEnabled = true;
            searchEnabled = false;
        } else if (modelLower === "deepseek-v3-search" || modelLower === "deepseek-chat-search") {
            thinkingEnabled = false;
            searchEnabled = true;
        } else if (modelLower === "deepseek-r1-search" || modelLower === "deepseek-reasoner-search") {
            thinkingEnabled = true;
            searchEnabled = true;
        } else {
            return c.json({ error: { message: `Model '${model}' is not available.`, type: "invalid_request_error" } }, 503);
        }

        const finalPrompt = messagesPrepare(messages);

        const sessionId = await createSession(authCtx);
        if (!sessionId) {
            return c.json({ error: { message: "invalid token.", type: "invalid_request_error" } }, 401);
        }

        const powResp = await getPowResponse(authCtx);
        if (!powResp) {
            return c.json({ error: { message: "Failed to get PoW (invalid token or unknown error).", type: "server_error" } }, 401);
        }

        const headers = { ...getAuthHeaders(authCtx), "x-ds-pow-response": powResp };
        const payload = {
            chat_session_id: sessionId,
            parent_message_id: null,
            client_stream_id: generateClientStreamId(),
            prompt: finalPrompt,
            ref_file_ids: [],
            thinking_enabled: thinkingEnabled,
            search_enabled: searchEnabled,
            stream: !!stream,
        };

        const createdTime = Math.floor(Date.now() / 1000);
        const completionId = `${sessionId}`;

        if (stream) {
            const response = await fetch(DEEPSEEK_COMPLETION_URL, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const text = await response.text();
                logger.error(`DeepSeek API Error: ${response.status} ${text}`);
                return c.json({ error: { message: `DeepSeek API Error: ${response.status} ${text}`, type: "api_error" } }, response.status);
            }

            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();
            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response body");

            (async () => {
                let currentFragmentType = "thinking";
                let finalText = "";
                let finalThinking = "";
                let firstChunkSent = false;

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            await writer.write(encoder.encode("data: [DONE]\n\n"));
                            break;
                        }
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split("\n");

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith("data:")) continue;

                            const sseChunk = parseDeepseekSseLine(trimmed);
                            if (!sseChunk || sseChunk.type === "done") continue;

                            const { contents, isFinished, newFragmentType } = parseSseChunkForContent(
                                sseChunk,
                                thinkingEnabled,
                                currentFragmentType
                            );
                            currentFragmentType = newFragmentType;

                            for (const [content, type] of contents) {
                                if (searchEnabled && content.startsWith("[citation:")) continue;

                                if (type === "thinking") {
                                    if (thinkingEnabled) finalThinking += content;
                                } else {
                                    finalText += content;
                                }

                                const delta: any = {};
                                if (!firstChunkSent) {
                                    delta.role = "assistant";
                                    firstChunkSent = true;
                                }
                                if (type === "thinking") {
                                    if (thinkingEnabled) delta.reasoning_content = content;
                                } else {
                                    delta.content = content;
                                }

                                if (Object.keys(delta).length > 0) {
                                    const openaiChunk = {
                                        id: completionId,
                                        object: "chat.completion.chunk",
                                        created: createdTime,
                                        model,
                                        choices: [{
                                            index: 0,
                                            delta,
                                            finish_reason: null,
                                        }],
                                    };
                                    await writer.write(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
                                }
                            }

                            if (isFinished) {
                                const promptTokens = estimateTokens(finalPrompt);
                                const thinkingTokens = estimateTokens(finalThinking);
                                const completionTokens = estimateTokens(finalText);
                                const usage = {
                                    prompt_tokens: promptTokens,
                                    completion_tokens: thinkingTokens + completionTokens,
                                    total_tokens: promptTokens + thinkingTokens + completionTokens,
                                    completion_tokens_details: {
                                        reasoning_tokens: thinkingTokens,
                                    },
                                };
                                const finishChunk = {
                                    id: completionId,
                                    object: "chat.completion.chunk",
                                    created: createdTime,
                                    model,
                                    choices: [{
                                        index: 0,
                                        delta: {},
                                        finish_reason: "stop",
                                    }],
                                    usage,
                                };
                                await writer.write(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
                                await writer.write(encoder.encode("data: [DONE]\n\n"));
                                return;
                            }
                        }
                    }
                } catch (e) {
                    logger.error(`Stream error: ${e}`);
                    try {
                        await writer.write(encoder.encode(`data: {"error": "${String(e)}"}\n\n`));
                    } catch {}
                } finally {
                    await authCtx.release();
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
        }

        const response = await fetch(DEEPSEEK_COMPLETION_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const text = await response.text();
            logger.error(`DeepSeek API Error: ${response.status} ${text}`);
            return c.json({ error: { message: `DeepSeek API Error: ${response.status} ${text}`, type: "api_error" } }, response.status);
        }

        const decoder = new TextDecoder();
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        let finalText = "";
        let finalThinking = "";
        let currentFragmentType = "thinking";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) continue;

                const sseChunk = parseDeepseekSseLine(trimmed);
                if (!sseChunk || sseChunk.type === "done") continue;

                const { contents, isFinished, newFragmentType } = parseSseChunkForContent(
                    sseChunk,
                    thinkingEnabled,
                    currentFragmentType
                );
                currentFragmentType = newFragmentType;

                for (const [content, type] of contents) {
                    if (searchEnabled && content.startsWith("[citation:")) continue;
                    if (type === "thinking") {
                        if (thinkingEnabled) finalThinking += content;
                    } else {
                        finalText += content;
                    }
                }

                if (isFinished) break;
            }
        }

        const promptTokens = estimateTokens(finalPrompt);
        const reasoningTokens = estimateTokens(finalThinking);
        const completionTokens = estimateTokens(finalText);

        return c.json({
            id: completionId,
            object: "chat.completion",
            created: createdTime,
            model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: finalText,
                        reasoning_content: finalThinking,
                    },
                    finish_reason: "stop",
                },
            ],
            usage: {
                prompt_tokens: promptTokens,
                completion_tokens: reasoningTokens + completionTokens,
                total_tokens: promptTokens + reasoningTokens + completionTokens,
                completion_tokens_details: {
                    reasoning_tokens: reasoningTokens,
                },
            },
        });
    } catch (e) {
        logger.error(`Chat completion error: ${e}`);
        return c.json({ error: { message: String(e), type: "server_error" } }, 500);
    } finally {
        if (authCtx) {
            await authCtx.release();
        }
    }
});

export default router;
