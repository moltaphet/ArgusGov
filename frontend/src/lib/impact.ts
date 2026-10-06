import { decodeActions, MAX_UINT256 } from "./decode";
import type { Proposal } from "./types";

const VALUE_CATEGORIES = new Set(["TOKEN_TRANSFER", "TOKEN_TRANSFER_FROM", "MINT", "WITHDRAW"]);

export interface Impact {
  /** Proposals whose execution is currently frozen. */
  drainsThwarted: number;
  /** Whole tokens (18 decimals assumed) the frozen proposals would have moved or minted. */
  tokensProtected: bigint;
  /** A frozen proposal also carried an unlimited approval. */
  unlimitedApprovals: number;
}

export function computeImpact(proposals: Proposal[]): Impact {
  const impact: Impact = { drainsThwarted: 0, tokensProtected: 0n, unlimitedApprovals: 0 };
  for (const p of proposals.filter((x) => x.frozen)) {
    impact.drainsThwarted += 1;
    for (const a of decodeActions(p.targets, p.calldatas)) {
      if (a.amountRaw === undefined) continue;
      if (a.amountRaw === MAX_UINT256) impact.unlimitedApprovals += 1;
      else if (VALUE_CATEGORIES.has(a.category)) impact.tokensProtected += a.amountRaw / 10n ** 18n;
    }
  }
  return impact;
}
