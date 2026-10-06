"use client";

import { useAccount } from "wagmi";
import { rememberInspectHash } from "@/lib/consensus";
import { PROTOCOL } from "@/lib/networks";
import { ContractRevertError } from "@/lib/errors";
import type { ProposalStatus } from "@/lib/types";
import { useContractWrite } from "./useContractWrite";

/** Runs validator consensus on a REGISTERED proposal, then links the receipt to it. */
export function useInspectProposal() {
  const write = useContractWrite("Validator inspection");
  const { address: me } = useAccount();

  async function inspect(proposalId: number, status?: ProposalStatus, flag?: { challenger: string; proposedAt: number }): Promise<boolean> {
    const hash = await write.run("inspect_proposal", [BigInt(proposalId)], {
      preflight: async () => {
        if (status && status !== "REGISTERED") throw new ContractRevertError("[EXPECTED] proposal is not awaiting inspection");
        if (flag && me?.toLowerCase() !== flag.challenger.toLowerCase() && Date.now() / 1000 < flag.proposedAt + PROTOCOL.inspectionExclusiveSeconds) {
          throw new ContractRevertError("[EXPECTED] inspection is reserved for the challenger during the first 30 minutes");
        }
      },
    });
    if (hash) rememberInspectHash(proposalId, hash);
    return hash !== null;
  }

  return { ...write, inspect };
}

/** Settles a recorded verdict: score >= 75 freezes the proposal, otherwise the bond is slashed. */
export function useExecuteCircuitBreaker() {
  const write = useContractWrite("Circuit breaker");
  const execute = async (proposalId: number) => (await write.run("execute_circuit_breaker", [BigInt(proposalId)])) !== null;
  return { ...write, execute };
}
