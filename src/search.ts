import { MAX_MATCHES } from "./limits.ts";
import type { SearchMatch } from "./types.ts";

/** Literal text only: user input never becomes an executable or arbitrary regex. */
export function findMatches(
  text: string,
  query: string,
  matchCase: boolean,
): { matches: SearchMatch[]; truncated: boolean } {
  if (!query) return { matches: [], truncated: false };
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(escaped, matchCase ? "gu" : "giu");
  const matches: SearchMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(text)) !== null) {
    if (matches.length === MAX_MATCHES) return { matches, truncated: true };
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return { matches, truncated: false };
}
