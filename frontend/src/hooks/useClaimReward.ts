"use client";

import { useState } from "react";
import { useContractWrite } from "./useContractWrite";

export type ClaimStep = "idle" | "vesting" | "withdrawing" | "done";

/**
 * Collects a challenger's refunded bond plus bounty once the 24h appeal window has
 * closed. The contract credits the reward to a claimable balance first
 * (claim_reward) and pays it out in a second, pull-pattern call (claim_payout),
 * so the hook runs both and reports which step it is on.
 */
export function useClaimReward() {
  const write = useContractWrite("Claim bounty");
  const [step, setStep] = useState<ClaimStep>("idle");

  async function claim(proposalId: number): Promise<boolean> {
    setStep("vesting");
    if ((await write.run("claim_reward", [BigInt(proposalId)])) === null) {
      setStep("idle");
      return false;
    }
    setStep("withdrawing");
    if ((await write.run("claim_payout", [])) === null) {
      // The reward is already in the claimable balance; only the withdrawal is outstanding.
      setStep("idle");
      return false;
    }
    setStep("done");
    return true;
  }

  return { ...write, step, claim, isSuccess: step === "done" && write.isSuccess };
}
