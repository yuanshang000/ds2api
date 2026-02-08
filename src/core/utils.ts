
export function getAccountIdentifier(account: any): string {
  return (account.email || "").trim() || (account.mobile || "").trim();
}

export function estimateTokens(text: string | any): number {
  if (typeof text === "string") {
    return Math.max(1, Math.floor(text.length / 4));
  } else if (Array.isArray(text)) {
    return text.reduce((acc, item) => {
      const content = typeof item === "object" ? (item.text || "") : String(item);
      return acc + estimateTokens(content);
    }, 0);
  } else {
    return Math.max(1, Math.floor(String(text).length / 4));
  }
}
