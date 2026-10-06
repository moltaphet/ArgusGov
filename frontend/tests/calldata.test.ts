import { describe, expect, it } from "vitest";
import { decodeAction, decodeActions, MAX_UINT256 } from "@/lib/decode";
import { computeImpact } from "@/lib/impact";
import { compareAmount, findAmountMentions, tokensFromRaw } from "@/lib/intent";
import type { Proposal } from "@/lib/types";
import { proposal } from "./helpers";
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
    expect(decodeAction(0, TOKEN, "0x").category).toBe("NOOP");                 // no calldata and no value does nothing
    expect(decodeAction(0, TOKEN, "0x", 1n).category).toBe("NATIVE_TRANSFER");  // ...but a value makes it a send
    expect(decodeAction(0, TOKEN, "0xabc").category).toBe("MALFORMED");
    expect(decodeActions([TOKEN], [])[0].category).toBe("NOOP");
  });

  it("decodes native value sent with an otherwise empty call as a native transfer", () => {
    const send = decodeAction(0, EVIL, "0x", 1_000n * GEN);
    expect(send.category).toBe("NATIVE_TRANSFER");
    expect(send.severity).toBe("high");
    expect(send.value).toBe(1_000n * GEN);
    expect(send.details).toContainEqual({ label: "native value", value: `${1_000n * GEN} wei` });
    expect(decodeAction(0, TOKEN, "0x").category).toBe("NOOP");                      // nothing to do, nothing to flag
  });

  it("keeps native value attached to a contract call and still decodes the call", () => {
    const call = decodeAction(0, TOKEN, transferCalldata(EVIL, 5n * GEN), 2n * GEN);
    expect(call.signature).toBe("transfer(address,uint256)");
    expect(call.value).toBe(2n * GEN);
    expect(call.amountRaw).toBe(5n * GEN);                                           // token amount and native value stay separate
    expect(call.details.map((d) => d.label)).toEqual(["recipient", "amount", "native value"]);
  });

  it("pairs values with actions by position and defaults missing ones to zero", () => {
    const decoded = decodeActions([TOKEN, EVIL, TOKEN], ["0x", "0x", "0x"], [0n, 7n]);
    expect(decoded.map((a) => a.value)).toEqual([0n, 7n, 0n]);
  });

  it("flags a native drain against a post that promises a small amount", () => {
    const drain = decodeAction(0, EVIL, "0x", 1_000n * GEN);
    const verdict = compareAmount(tokensFromRaw(drain.value), findAmountMentions("Pay the contractor 5 ETH."));
    expect(verdict.kind === "exceeds" && verdict.ratio >= 100).toBe(true);
  });

  it("sums the tokens and native currency held back by frozen proposals", () => {
    const frozenDrain = (frozen: boolean, amount: bigint, native = 0n): Proposal => proposal({
      frozen, targets: [TOKEN, EVIL], values: [0n, native], calldatas: [transferCalldata(EVIL, amount), "0x"],
    });
    const impact = computeImpact([frozenDrain(true, 9_999_999n * GEN, 40n * GEN), frozenDrain(true, 1n * GEN, 2n * GEN), frozenDrain(false, 500n * GEN, 9n * GEN)]);
    expect(impact.drainsThwarted).toBe(2);
    expect(impact.tokensProtected).toBe(10_000_000n);
    expect(impact.nativeProtected).toBe(42n);
  });
});
