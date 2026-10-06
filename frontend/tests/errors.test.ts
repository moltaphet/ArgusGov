import { describe, expect, it } from "vitest";
import { ContractRevertError, decodeContractError } from "@/lib/errors";
import { revertMessageFrom } from "@/lib/genlayer";

describe("contract error decoder", () => {
  it.each([
    ["[EXPECTED] challenger is in cooling period", "Active cooling period"],
    ["[EXPECTED] challenge bond must equal min_challenge_bond", "Insufficient bond"],
    ["[EXPECTED] this proposal payload was already flagged", "Proposal already flagged"],
    ["[EXPECTED] rate limit exceeded for caller", "Rate limit reached"],
    ["[EXPECTED] rate limit exceeded for DAO", "DAO rate limit reached"],
    ["[EXPECTED] DAO not registered", "DAO not registered"],
    ["[EXPECTED] appeal window still open", "Appeal window still open"],
    ["[EXPECTED] only the DAO guardian can appeal", "Guardian only"],
    ["[EXPECTED] proposal is not awaiting inspection", "Already inspected"],
    ["[LLM_ERROR] is_malicious contradicts score", "Validators could not agree"],
    ["[EXPECTED] re-flag bond must equal 2x min_challenge_bond", "Re-flag bond required"],
    ["[EXPECTED] re-flag limit reached for this proposal", "Re-flag limit reached"],
    ["[EXPECTED] Proposal not committed by DAO", "Proposal not committed"],
    ["[EXPECTED] proposal already committed", "Already committed"],
    ["[EXPECTED] only the DAO guardian or the timelock can commit proposals", "Guardian or timelock only"],
    ["[EXPECTED] only the timelock can claim guardianship", "Timelock only"],
    ["[EXPECTED] invalid dao_key: expected chain_id:0xaddress", "Invalid DAO key"],
    ["[EXPECTED] values must have one entry per target", "Check the native values"],
    ["[EXPECTED] freeze is still justified", "Freeze still justified"],
    ["[EXPECTED] proposal is not frozen", "Not frozen"],
    ["[EXPECTED] flag has not expired", "Flag has not expired"],
    ["[EXPECTED] only an uninspected flag can expire", "Cannot expire"],
    ["[EXPECTED] amount exceeds withdrawable pool", "Amount too large"],
  ])("maps %s", (raw, title) => {
    expect(decodeContractError(new ContractRevertError(raw)).title).toBe(title);
  });

  it("recognises wallet rejections, empty wallets and chain mismatches", () => {
    expect(decodeContractError(new Error("User rejected the request.")).code).toBe("USER_REJECTED");
    expect(decodeContractError(new Error("insufficient funds for gas * price + value")).code).toBe("INSUFFICIENT_FUNDS");
    expect(decodeContractError(new Error("The current chain of the wallet does not match: chain mismatch")).code).toBe("WRONG_CHAIN");
  });

  it("falls back to the contract's own words, without the classification prefix", () => {
    const decoded = decodeContractError(new ContractRevertError("[EXPECTED] some brand new rule"));
    expect(decoded.code).toBe("UNKNOWN");
    expect(decoded.message).toBe("some brand new rule");
  });

  it("never throws on odd inputs", () => {
    for (const input of [undefined, null, 42, {}, "", new Error("")]) expect(() => decodeContractError(input)).not.toThrow();
  });
});

describe("revert extraction from a consensus receipt", () => {
  // Shape captured from Studio Next for a call the contract rejected: the transaction is
  // decided with FINISHED_WITH_ERROR and the contract's text rides in the leader receipt.
  const receipt = {
    txExecutionResultName: "FINISHED_WITH_ERROR",
    consensus_data: { leader_receipt: [{ result: { status: "rollback", payload: "[EXPECTED] challenge bond must equal min_challenge_bond" } }] },
  };

  it("reads the contract's revert text and decodes it end to end", () => {
    const message = revertMessageFrom(receipt);
    expect(message).toBe("[EXPECTED] challenge bond must equal min_challenge_bond");
    expect(decodeContractError(new ContractRevertError(message!)).title).toBe("Insufficient bond");
  });

  it("accepts camelCase receipts and tolerates missing data", () => {
    expect(revertMessageFrom({ consensusData: receipt.consensus_data })).toContain("[EXPECTED]");
    expect(revertMessageFrom({})).toBeUndefined();
    expect(revertMessageFrom(undefined)).toBeUndefined();
    expect(revertMessageFrom({ consensus_data: { leader_receipt: [{ result: { payload: { raw: 1 } } }] } })).toBeUndefined();
  });
});
