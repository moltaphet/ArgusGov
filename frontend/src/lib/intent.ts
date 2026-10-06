// Heuristic helpers for the audit view. They only decorate the display: the
// authoritative verdict is always the validators' consensus score.

export interface Mention {
  start: number;
  end: number;
  /** Amount in whole tokens. */
  value: number;
  text: string;
}

const AMOUNT = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?\b(?=\s*(?:\w+\s){0,2}?(?:tokens?|gen|eth|usdc|usdt|dai|grant|funds?)\b)|(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)\b/gi;

export function findAmountMentions(text: string): Mention[] {
  const out: Mention[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const num = (m[1] ?? m[3] ?? "").replace(/,/g, "");
    const unit = (m[2] ?? m[4] ?? "").toLowerCase();
    let value = Number(num);
    if (!Number.isFinite(value)) continue;
    if (unit === "k" || unit === "thousand") value *= 1_000;
    if (unit === "m" || unit === "million") value *= 1_000_000;
    if (value <= 0) continue;
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value, text: m[0] });
  }
  return out;
}

export type AmountVerdict =
  | { kind: "undisclosed" }
  | { kind: "exceeds"; ratio: number; declared: number }
  | { kind: "consistent" };

/** Compares an on-chain token amount (whole tokens) with the amounts the post promises. */
export function compareAmount(executedTokens: number, mentions: Mention[]): AmountVerdict {
  if (mentions.length === 0) return { kind: "undisclosed" };
  const declared = Math.max(...mentions.map((m) => m.value));
  const ratio = executedTokens / declared;
  return ratio > 1.5 ? { kind: "exceeds", ratio, declared } : { kind: "consistent" };
}

export function tokensFromRaw(raw: bigint): number {
  return Number(raw / 10n ** 14n) / 10_000;
}
