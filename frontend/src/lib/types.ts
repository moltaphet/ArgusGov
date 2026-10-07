export type ProposalStatus =
  | "REGISTERED"
  | "ANALYZING"
  | "VERIFIED_SAFE"
  | "FLAGGED_MALICIOUS"
  | "CHALLENGED_PAUSED"
  | "RESOLVED_DISPUTED"
  | "EXPIRED";

export interface Proposal {
  id: number;
  daoKey: string;
  daoAddress: string;
  /** uint256: a Governor-derived id has 77 digits, far past Number.MAX_SAFE_INTEGER. */
  daoProposalId: bigint;
  forumUrl: string;
  targets: string[];
  values: bigint[];
  calldatas: string[];
  proposedAt: number;
  challenger: string;
  challengerBond: bigint;
  threatScore: number;
  status: ProposalStatus;
  reasoningHash: string;
  payloadHash: string;
  appellant: string;
  appealBond: bigint;
  flaggedAt: number;
  rewardAmount: bigint;
  rewardClaimed: boolean;
  resolution: string;
  /** This record is the one allowed re-flag of a proposal first judged safe. */
  isReflag: boolean;
  /** On-chain is_execution_frozen for this DAO proposal id. */
  frozen: boolean;
}

/** A proposal payload the DAO committed; challengers flag it by (daoKey, daoProposalId) alone. */
export interface CommittedProposal {
  daoKey: string;
  daoAddress: string;
  chainId: number;
  /** uint256: a Governor-derived id has 77 digits, far past Number.MAX_SAFE_INTEGER. */
  daoProposalId: bigint;
  forumUrl: string;
  targets: string[];
  values: bigint[];
  calldatas: string[];
  payloadHash: string;
  committedBy: string;
  committedAt: number;
  /** Record id of the latest flag, 0 when nobody has flagged it. */
  flagId: number;
  /** Re-flags used after a SAFE verdict (the contract allows one). */
  reflagCount: number;
  /** Status of the latest flag, empty when there is none. */
  flagStatus: string;
  /** True when a challenge can be raised right now. */
  flaggable: boolean;
  /** Bond the next challenge must post, in wei: the base bond, or double after a SAFE verdict. 0 when not flaggable. */
  requiredBond: bigint;
  frozen: boolean;
  /** Where the proposal came from; UNVERIFIED until someone runs attest_provenance. */
  provenance: Provenance;
}

export type ProvenanceStatus = "UNVERIFIED" | "VERIFIED" | "ORPHAN";

/** Origin-chain proof for a committed proposal (empty strings until attested). */
export interface Provenance {
  status: ProvenanceStatus;
  /** Governor on the origin chain that created the proposal. */
  governor: string;
  /** keccak256(description) the Governor id was derived with. */
  descriptionHash: string;
  /** keccak256(chainId, governor, proposalId, payloadHash, descriptionHash). */
  binding: string;
  attestedAt: number;
}

export interface SecurityPool {
  daoKey: string;
  daoAddress: string;
  guardian: string;
  stake: bigint;
  locked: bigint;
  withdrawable: bigint;
  minChallengeBond: bigint;
  coolingPeriod: number;
}

export interface Ledger {
  pool: bigint;
  escrow: bigint;
  claimable: bigint;
  burnVault: bigint;
  balance: bigint;
}

export interface DaoSummary {
  /** "<chain_id>:<0xtimelock>" */
  key: string;
  address: string;
  chainId: number;
  committed: CommittedProposal[];
  pool: SecurityPool | null;
  proposals: Proposal[];
  /** Paused when any proposal of the DAO is currently frozen. */
  paused: boolean;
}
