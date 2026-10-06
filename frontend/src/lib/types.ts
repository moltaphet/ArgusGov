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
  daoProposalId: number;
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
  /** On-chain is_execution_frozen for this DAO proposal id. */
  frozen: boolean;
}

/** A proposal payload the DAO committed; challengers flag it by (daoKey, daoProposalId) alone. */
export interface CommittedProposal {
  daoKey: string;
  daoAddress: string;
  chainId: number;
  daoProposalId: number;
  forumUrl: string;
  targets: string[];
  values: bigint[];
  calldatas: string[];
  payloadHash: string;
  committedBy: string;
  committedAt: number;
  /** Record id of the live flag, 0 when nobody has flagged it. */
  flagId: number;
  frozen: boolean;
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
