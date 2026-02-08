
import { logger } from "../config.ts";

export function messagesPrepare(messages: any[]): string {
  const processed = messages.map(m => {
    const role = m.role || "";
    let text = "";
    if (Array.isArray(m.content)) {
      text = m.content
        .filter((item: any) => item.type === "text")
        .map((item: any) => item.text || "")
        .join("\n");
    } else {
      text = String(m.content || "");
    }
    return { role, text };
  });

  if (processed.length === 0) return "";

  const merged = [processed[0]];
  for (let i = 1; i < processed.length; i++) {
    if (processed[i].role === merged[merged.length - 1].role) {
      merged[merged.length - 1].text += "\n\n" + processed[i].text;
    } else {
      merged.push(processed[i]);
    }
  }

  const parts: string[] = [];
  merged.forEach((block, idx) => {
    const { role, text } = block;
    if (role === "assistant") {
      parts.push(`<｜Assistant｜>${text}<｜end▁of▁sentence｜>`);
    } else if (role === "user" || role === "system") {
      if (idx > 0) {
        parts.push(`<｜User｜>${text}`);
      } else {
        parts.push(text);
      }
    } else {
      parts.push(text);
    }
  });

  let finalPrompt = parts.join("");
  // Remove markdown images ![...] (...)
  finalPrompt = finalPrompt.replace(/!\[(.*?)\]\((.*?)\)/g, "[$1]($2)");
  return finalPrompt;
}
