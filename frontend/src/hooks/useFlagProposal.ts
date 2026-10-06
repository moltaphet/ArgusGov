"use client";

import { useAccount } from "wagmi";
import { parseEther } from "viem";
import { ContractRevertError } from "@/lib/errors";
import { readView } from "@/lib/genlayer";
import { useContractWrite } from "./useContractWrite";

/** The challenge bond is fixed by the contract: exactly 2.0 GEN. */
export const CHALLENGE_BOND = parseEther("2.0");

export interface FlagProposalInput {
  /** "<chain_id>:<0xtimelock>" */
  daoKey: string;
  proposalId: string | number | bigint;
}

/**
 * Posts the 2.0 GEN bond and flags a proposal the DAO has committed. A challenger names the
 * proposal and nothing else: its targets, values, calldata and forum link come from the DAO's
 * own commitment, so there is no payload to forge.
 *
 * The simulating stage reads the contract first, so a known failure (unregistered DAO,
 * proposal not committed or already flagged, active cooling period) is reported before the
 * wallet is asked to sign anything.
 */
export function useFlagProposal() {
  const { address } = useAccount();
  const write = useContractWrite("Challenge bond");

  async function submit(input: FlagProposalInput): Promise<boolean> {
    const daoKey = input.daoKey.trim().toLowerCase();
    const proposalId = BigInt(input.proposalId);
    const hash = await write.run("flag_proposal", [daoKey, proposalId], {
      value: CHALLENGE_BOND,
      preflight: async () => {
        const pool = await readView<{ guardian?: string }>("get_security_pool", [daoKey]);
        if (!pool.guardian) throw new ContractRevertError("[EXPECTED] DAO not registered");
        let committed: { flag_id?: number | string };
        try {
          committed = await readView("get_committed_proposal", [daoKey, proposalId]);
        } catch {
          throw new ContractRevertError("[EXPECTED] Proposal not committed by DAO");
        }
        if (Number(committed.flag_id) !== 0) throw new ContractRevertError("[EXPECTED] this proposal is already flagged");
        if (address) {
          const until = Number(await readView<number>("get_cooldown_until", [address.toLowerCase()]));
          if (until > Date.now() / 1000) throw new ContractRevertError("[EXPECTED] challenger is in cooling period");
        }
      },
    });
    return hash !== null;
  }

  return { ...write, submit, bond: CHALLENGE_BOND };
}
