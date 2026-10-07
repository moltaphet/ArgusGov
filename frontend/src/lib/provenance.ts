import { encodeAbiParameters, keccak256, toBytes } from "viem";
import type { CommittedProposal, ProvenanceStatus } from "./types";

/**
 * The canonical OpenZeppelin Governor proposal id:
 * keccak256(abi.encode(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash)).
 * ArgusGov recomputes exactly this in `attest_provenance` and rejects a proposal whose id differs.
 */
export function deriveGovernorProposalId(targets: string[], values: bigint[], calldatas: string[], descriptionHash: string): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
        [targets as `0x${string}`[], values, calldatas as `0x${string}`[], descriptionHash as `0x${string}`],
      ),
    ),
  );
}

/** keccak256 of a Governor proposal description, the `descriptionHash` of `propose`. */
export const descriptionHashOf = (description: string): `0x${string}` => keccak256(toBytes(description));

export interface ProvenanceView {
  status: ProvenanceStatus;
  tone: "safe" | "warn" | "crit";
  headline: string;
  detail: string;
  governor: string;
  chainId: number;
  descriptionHash: string;
  /** The submitted payload still derives the id it claims. Checked locally, from the stored fields. */
  idMatches: boolean | null;
}

/** What the "Provenance Status" badge shows for one committed proposal. */
export function provenanceView(c: CommittedProposal): ProvenanceView {
  const { status, governor, descriptionHash } = c.provenance;
  const base = { status, governor, chainId: c.chainId, descriptionHash, idMatches: null as boolean | null };
  if (status === "VERIFIED") {
    const idMatches = /^0x[0-9a-fA-F]{64}$/.test(descriptionHash)
      ? deriveGovernorProposalId(c.targets, c.values, c.calldatas, descriptionHash) === BigInt(c.daoProposalId)
      : null;
    return { ...base, tone: "safe", headline: "VERIFIED ON-CHAIN ORIGIN", idMatches,
      detail: "Validators confirmed over RPC consensus that this Governor created the proposal and may queue on the timelock." };
  }
  if (status === "ORPHAN") {
    return { ...base, tone: "crit", headline: "ORPHAN: NO ON-CHAIN ORIGIN",
      detail: "The origin chain has no such proposal, or the Governor is not authorised on the timelock. It cannot be flagged." };
  }
  return { ...base, tone: "warn", headline: "PROVENANCE UNVERIFIED",
    detail: "Committed, but nobody has attested its origin yet. Anyone can run attest_provenance." };
}
