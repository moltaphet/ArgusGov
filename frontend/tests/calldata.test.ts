import { describe, expect, it } from "vitest";
import { decodeAction, decodeActions, MAX_UINT256 } from "@/lib/decode";
import { computeImpact } from "@/lib/impact";
import { compareAmount, findAmountMentions, tokensFromRaw } from "@/lib/intent";
import type { Proposal } from "@/lib/types";
import { EVIL, GEN, TOKEN, approveCalldata, transferCalldata } from "./helpers";

describe("calldata decoder", () => {
  it("extracts the function signature, recipient and amount of a transfer", () => {
    const a = decodeAction(0, TOKEN, transferCalldata(EVIL, 9_999_999n * GEN));
    expect(a.signature).toBe("transfer(address,uint256)");
    expect(a.category).toBe("TOKEN_TRANSFER");
    expect(a.selector).toBe("0xa9059cbb");
    expect(a.details.find((d) => d.label === "recipient")?.value).toBe(EVIL);
    expect(a.amountRaw).toBe(9_999_999n * GEN);
  });

  it("flags a transfer far larger than the amount the forum post promises", () => {
    const action = decodeAction(0, TOKEN, transferCalldata(EVIL, 9_999_999n * GEN));
    const promised = findAmountMentions("Marketing grant of 5k tokens for the Q3 campaign.");
    expect(promised.map((m) => m.value)).toEqual([5000]);
    const verdict = compareAmount(tokensFromRaw(action.amountRaw!), promised);
    expect(verdict.kind).toBe("exceeds");
    if (verdict.kind === "exceeds") expect(verdict.ratio).toBeGreaterThan(1000);
  });

  it("accepts a transfer that matches the promised amount", () => {
    const action = decodeAction(0, TOKEN, transferCalldata(EVIL, 5_000n * GEN));
    expect(compareAmount(tokensFromRaw(action.amountRaw!), findAmountMentions("a 5,000 token grant")).kind).toBe("consistent");
  });

  it("treats an amount with no declared figure as undisclosed", () => {
    expect(compareAmount(1_000_000, findAmountMentions("General maintenance work.")).kind).toBe("undisclosed");
  });

  it("recognises unlimited approvals", () => {
    const a = decodeAction(0, TOKEN, approveCalldata(EVIL, MAX_UINT256));
    expect(a.category).toBe("TOKEN_APPROVAL");
    expect(a.amountRaw).toBe(MAX_UINT256);
    expect(a.details.find((d) => d.label === "amount")?.value).toMatch(/UNLIMITED/);
  });

  it("marks privileged selectors critical and unknown selectors high", () => {
    expect(decodeAction(0, TOKEN, "0x3659cfe6" + EVIL.slice(2).padStart(64, "0")).severity).toBe("critical");
    const unknown = decodeAction(0, TOKEN, "0xdeadbeef");
    expect(unknown.category).toBe("UNKNOWN");
    expect(unknown.severity).toBe("high");
  });

  it("handles empty and truncated calldata without throwing", () => {
    expect(decodeAction(0, TOKEN, "0x").category).toBe("NATIVE_TRANSFER");
    expect(decodeAction(0, TOKEN, "0xabc").category).toBe("MALFORMED");
    expect(decodeActions([TOKEN], [])[0].category).toBe("NATIVE_TRANSFER");
  });

  it("sums the tokens held back by frozen proposals", () => {
    const proposal = (frozen: boolean, amount: bigint): Proposal => ({
      id: 1, daoAddress: "0xd", daoProposalId: 1, forumUrl: "", targets: [TOKEN], calldatas: [transferCalldata(EVIL, amount)], proposedAt: 0,
      challenger: "", challengerBond: 0n, threatScore: 90, status: "FLAGGED_MALICIOUS", reasoningHash: "", payloadHash: "", appellant: "",
      appealBond: 0n, flaggedAt: 0, rewardAmount: 0n, rewardClaimed: false, resolution: "", frozen,
    });
    const impact = computeImpact([proposal(true, 9_999_999n * GEN), proposal(true, 1n * GEN), proposal(false, 500n * GEN)]);
    expect(impact.drainsThwarted).toBe(2);
    expect(impact.tokensProtected).toBe(10_000_000n);
  });
});
