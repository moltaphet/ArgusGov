export type ProposalStatus =
  | "REGISTERED"
  | "ANALYZING"
  | "VERIFIED_SAFE"
  | "FLAGGED_MALICIOUS"
  | "CHALLENGED_PAUSED"
  | "RESOLVED_DISPUTED";

export interface Proposal {
  id: number;
  daoAddress: string;
  daoProposalId: number;
  forumUrl: string;
  targets: string[];
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

export interface SecurityPool {
  daoAddress: string;
  guardian: string;
  stake: bigint;
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
  address: string;
  pool: SecurityPool | null;
  proposals: Proposal[];
  /** Paused when any proposal of the DAO is currently frozen. */
  paused: boolean;
}
