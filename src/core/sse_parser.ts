
// deno/src/core/sse_parser.ts

import { logger } from "../config.ts";

export interface SseChunk {
  type?: string;
  p?: string;
  o?: string;
  v?: any;
  error?: any;
  code?: string;
}

const SKIP_PATTERNS = [
  "quasi_status", "elapsed_secs", "token_usage",
  "pending_fragment", "conversation_mode",
  "fragments/-1/status", "fragments/-2/status", "fragments/-3/status",
  "response/search_status"
];

function shouldSkipChunk(chunkPath: string): boolean {
  if (chunkPath === "response/search_status") return true;
  return SKIP_PATTERNS.some(kw => chunkPath.includes(kw));
}

function isResponseFinished(chunkPath: string, vValue: any): boolean {
  return chunkPath === "response/status" && typeof vValue === "string" && vValue === "FINISHED";
}

function isFinishedSignal(chunkPath: string, vValue: string): boolean {
  return vValue === "FINISHED" && (!chunkPath || chunkPath === "status");
}

function isSearchResult(item: any): boolean {
  return typeof item === "object" && item !== null && "url" in item && "title" in item;
}

function extractContentFromItem(item: any, defaultType: string): [string, string] | null {
  if (item && typeof item === "object" && "content" in item && "type" in item) {
    const innerType = String(item.type || "").toUpperCase();
    const content = String(item.content || "");
    if (content) {
      if (innerType === "THINK" || innerType === "THINKING") {
        return [content, "thinking"];
      } else if (innerType === "RESPONSE") {
        return [content, "text"];
      } else {
        return [content, defaultType];
      }
    }
  }
  return null;
}

function extractContentRecursive(items: any[], defaultType: string): [string, string][] | null {
  const extracted: [string, string][] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const itemP = item.p || "";
    const itemV = item.v;

    // Skip search results
    if (isSearchResult(item)) continue;

    // Check finished signal
    if (itemP === "status" && itemV === "FINISHED") {
      return null;
    }

    // Skip status related
    if (shouldSkipChunk(itemP)) continue;

    // Direct content check
    const result = extractContentFromItem(item, defaultType);
    if (result) {
      extracted.push(result);
      continue;
    }

    // Determine type based on p
    let contentType = defaultType;
    if (itemP.includes("thinking")) {
      contentType = "thinking";
    } else if (itemP.includes("content") || itemP === "response" || itemP === "fragments") {
      contentType = "text";
    }

    // Handle v value
    if (typeof itemV === "string") {
      if (itemV && itemV !== "FINISHED") {
        extracted.push([itemV, contentType]);
      }
    } else if (Array.isArray(itemV)) {
      for (const inner of itemV) {
        if (typeof inner === "object" && inner !== null) {
          const innerType = String(inner.type || "").toUpperCase();
          let finalType = contentType;
          if (innerType === "THINK" || innerType === "THINKING") {
            finalType = "thinking";
          } else if (innerType === "RESPONSE") {
            finalType = "text";
          }

          const content = inner.content || "";
          if (content) {
            extracted.push([content, finalType]);
          }
        } else if (typeof inner === "string" && inner) {
          extracted.push([inner, contentType]);
        }
      }
    }
  }
  return extracted;
}

export function parseSseChunkForContent(
  chunk: SseChunk,
  thinkingEnabled: boolean = false,
  currentFragmentType: string = "thinking"
): { contents: [string, string][], isFinished: boolean, newFragmentType: string } {

  if (!("v" in chunk)) {
    return { contents: [], isFinished: false, newFragmentType: currentFragmentType };
  }

  const vValue = chunk.v;
  const chunkPath = chunk.p || "";
  const contents: [string, string][] = [];
  let newFragmentType = currentFragmentType;

  if (shouldSkipChunk(chunkPath)) {
    return { contents: [], isFinished: false, newFragmentType: currentFragmentType };
  }

  if (isResponseFinished(chunkPath, vValue)) {
    return { contents: [], isFinished: true, newFragmentType: currentFragmentType };
  }

  // Detect fragment type change
  if (chunkPath === "response" && Array.isArray(vValue)) {
    for (const batchItem of vValue) {
      if (batchItem && batchItem.p === "fragments" && batchItem.o === "APPEND") {
        const fragments = batchItem.v || [];
        for (const frag of fragments) {
           if (frag && typeof frag === "object") {
             const fragType = String(frag.type || "").toUpperCase();
             if (fragType === "THINK" || fragType === "THINKING") {
               newFragmentType = "thinking";
             } else if (fragType === "RESPONSE") {
               newFragmentType = "text";
             }
           }
        }
      }
    }
  }

  if (chunkPath.includes("response/fragments") && Array.isArray(vValue)) {
     for (const frag of vValue) {
        if (frag && typeof frag === "object") {
            const fragType = String(frag.type || "").toUpperCase();
             if (fragType === "THINK" || fragType === "THINKING") {
               newFragmentType = "thinking";
             } else if (fragType === "RESPONSE") {
               newFragmentType = "text";
             }
        }
     }
  }

  // Determine ptype
  let ptype = "text";
  if (chunkPath === "response/thinking_content") {
    ptype = "thinking";
  } else if (chunkPath === "response/content") {
    ptype = "text";
  } else if (chunkPath.includes("response/fragments") && chunkPath.includes("/content")) {
    ptype = newFragmentType;
  } else if (!chunkPath) {
    if (thinkingEnabled) {
      ptype = newFragmentType;
    } else {
      ptype = "text";
    }
  } else {
    ptype = "text";
  }

  // Handle vValue
  if (typeof vValue === "string") {
    if (isFinishedSignal(chunkPath, vValue)) {
      return { contents: [], isFinished: true, newFragmentType };
    }
    if (vValue) {
      contents.push([vValue, ptype]);
    }
  } else if (Array.isArray(vValue)) {
    const result = extractContentRecursive(vValue, ptype);
    if (result === null) {
      return { contents: [], isFinished: true, newFragmentType };
    }
    contents.push(...result);
  }

  return { contents, isFinished: false, newFragmentType };
}

export function parseDeepseekSseLine(rawLine: string): SseChunk | null {
  if (!rawLine || !rawLine.startsWith("data:")) return null;
  const dataStr = rawLine.substring(5).trim();
  if (dataStr === "[DONE]") return { type: "done" };
  try {
    return JSON.parse(dataStr);
  } catch (e) {
    // logger.warning(`JSON parse failed: ${e}`);
    return null;
  }
}
