"use client";

import { useAccount } from "wagmi";
import { parseEther } from "viem";
import { ContractRevertError } from "@/lib/errors";
import { readView } from "@/lib/genlayer";
import { useContractWrite } from "./useContractWrite";

/** The challenge bond is fixed by the contract: exactly 2.0 GEN. */
export const CHALLENGE_BOND = parseEther("2.0");

export interface FlagProposalInput {
  daoAddress: string;
  proposalId: string | number | bigint;
  forumUrl: string;
  targets: string[];
  calldatas: string[];
}

/**
 * Posts the 2.0 GEN bond and flags a proposal. The simulating stage reads the
 * contract first, so a known failure (unregistered DAO, active cooling period)
 * is reported before the wallet is asked to sign anything.
 */
export function useFlagProposal() {
  const { address } = useAccount();
  const write = useContractWrite("Challenge bond");

  async function submit(input: FlagProposalInput): Promise<boolean> {
    const dao = input.daoAddress.trim().toLowerCase();
    const hash = await write.run(
      "flag_proposal",
      [dao, BigInt(input.proposalId), input.forumUrl.trim(), input.targets.map((t) => t.trim().toLowerCase()), input.calldatas.map((c) => c.trim().toLowerCase())],
      {
        value: CHALLENGE_BOND,
        preflight: async () => {
          const pool = await readView<{ guardian?: string }>("get_security_pool", [dao]);
          if (!pool.guardian) throw new ContractRevertError("[EXPECTED] DAO not registered");
          if (address) {
            const until = Number(await readView<number>("get_cooldown_until", [address.toLowerCase()]));
            if (until > Date.now() / 1000) throw new ContractRevertError("[EXPECTED] challenger is in cooling period");
          }
        },
      },
    );
    return hash !== null;
  }

  return { ...write, submit, bond: CHALLENGE_BOND };
}
