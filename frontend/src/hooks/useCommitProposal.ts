"use client";

import { useAccount } from "wagmi";
import { ContractRevertError } from "@/lib/errors";
import { readView } from "@/lib/genlayer";
import { computePayloadHash } from "@/lib/payloadHash";
import { useContractWrite } from "./useContractWrite";

export interface CommitProposalInput {
  /** "<chain_id>:<0xtimelock>" */
  daoKey: string;
  proposalId: string | number | bigint;
  forumUrl: string;
  targets: string[];
  /** Native currency per action, in wei. */
  values: bigint[];
  calldatas: string[];
}

/**
 * Guardian (or timelock) action: records the payload a proposal will execute so that
 * challengers can flag it by id alone. Commitments are write-once. The hook reports the
 * keccak256 commitment it expects the contract to store, for comparison with the DAO's own
 * proposal hash.
 */
export function useCommitProposal() {
  const { address } = useAccount();
  const write = useContractWrite("Commit proposal");

  async function commit(input: CommitProposalInput): Promise<boolean> {
    const daoKey = input.daoKey.trim().toLowerCase();
    const proposalId = BigInt(input.proposalId);
    const hash = await write.run(
      "commit_proposal",
      [daoKey, proposalId, input.targets.map((t) => t.trim().toLowerCase()), input.values, input.calldatas.map((c) => c.trim().toLowerCase()), input.forumUrl.trim()],
      {
        preflight: async () => {
          const pool = await readView<{ guardian?: string; dao_address?: string }>("get_security_pool", [daoKey]);
          if (!pool.guardian) throw new ContractRevertError("[EXPECTED] DAO not registered");
          const me = address?.toLowerCase();
          if (me !== pool.guardian.toLowerCase() && me !== pool.dao_address?.toLowerCase()) {
            throw new ContractRevertError("[EXPECTED] only the DAO guardian or the timelock can commit proposals");
          }
          const already = await readView("get_committed_proposal", [daoKey, proposalId]).then(() => true, () => false);
          if (already) throw new ContractRevertError("[EXPECTED] proposal already committed");
        },
      },
    );
    return hash !== null;
  }

  /** The commitment the contract will compute for this input. */
  const expectedHash = (input: Pick<CommitProposalInput, "targets" | "values" | "calldatas" | "forumUrl">) =>
    computePayloadHash(input.targets.map((t) => t.trim().toLowerCase()), input.values, input.calldatas.map((c) => c.trim().toLowerCase()), input.forumUrl.trim());

  return { ...write, commit, expectedHash };
}
