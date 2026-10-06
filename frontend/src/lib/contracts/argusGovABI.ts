// Method table for the deployed ArgusGov intelligent contract (contracts/argus_gov.py).
//
// GenLayer contracts are not EVM contracts: there is no Solidity ABI and no
// eth_call. genlayer-js calls them by method name with calldata-encoded
// arguments, so this table describes name, mutability, payability and argument
// types, and drives the typed call signatures below.
//
// A DAO is identified by `dao_key = "<chain_id>:<0xtimelock>"`, and a proposal is
// flagged by (dao_key, proposal_id) alone: its payload comes from what the DAO
// committed with `commit_proposal`, never from the challenger.

export const argusGovAbi = [
  // --- writes ---------------------------------------------------------------
  { name: "register_dao", kind: "write", payable: true, inputs: [{ name: "dao_key", type: "string" }] },
  { name: "claim_guardianship", kind: "write", payable: false, inputs: [{ name: "dao_key", type: "string" }] },
  { name: "withdraw_pool", kind: "write", payable: false, inputs: [{ name: "dao_key", type: "string" }, { name: "amount", type: "uint256" }] },
  {
    name: "commit_proposal", kind: "write", payable: false,
    inputs: [
      { name: "dao_key", type: "string" }, { name: "proposal_id", type: "uint256" }, { name: "targets", type: "string[]" },
      { name: "values", type: "uint256[]" }, { name: "calldatas", type: "string[]" }, { name: "forum_url", type: "string" },
    ],
  },
  { name: "flag_proposal", kind: "write", payable: true, inputs: [{ name: "dao_key", type: "string" }, { name: "proposal_id", type: "uint256" }] },
  { name: "expire_flag", kind: "write", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "inspect_proposal", kind: "write", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "execute_circuit_breaker", kind: "write", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "appeal_flag", kind: "write", payable: true, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "resolve_appeal", kind: "write", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "unfreeze_proposal", kind: "write", payable: false, inputs: [{ name: "dao_key", type: "string" }, { name: "proposal_id", type: "uint256" }] },
  { name: "claim_reward", kind: "write", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "claim_payout", kind: "write", payable: false, inputs: [] },
  // --- views ----------------------------------------------------------------
  { name: "solvency", kind: "view", payable: false, inputs: [] },
  { name: "get_ledger", kind: "view", payable: false, inputs: [] },
  { name: "get_proposal", kind: "view", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "get_proposal_verdict", kind: "view", payable: false, inputs: [{ name: "dao_key", type: "string" }, { name: "proposal_id", type: "uint256" }] },
  { name: "get_security_pool", kind: "view", payable: false, inputs: [{ name: "dao_key", type: "string" }] },
  { name: "get_dao_count", kind: "view", payable: false, inputs: [] },
  { name: "get_dao_key_at", kind: "view", payable: false, inputs: [{ name: "index", type: "uint256" }] },
  { name: "get_committed_proposal", kind: "view", payable: false, inputs: [{ name: "dao_key", type: "string" }, { name: "proposal_id", type: "uint256" }] },
  { name: "get_committed_count", kind: "view", payable: false, inputs: [] },
  { name: "get_committed_at", kind: "view", payable: false, inputs: [{ name: "index", type: "uint256" }] },
  { name: "is_execution_frozen", kind: "view", payable: false, inputs: [{ name: "dao_key", type: "string" }, { name: "dao_proposal_id", type: "uint256" }] },
  { name: "get_claimable", kind: "view", payable: false, inputs: [{ name: "who_hex", type: "string" }] },
  { name: "get_cooldown_until", kind: "view", payable: false, inputs: [{ name: "who_hex", type: "string" }] },
  { name: "whoami", kind: "view", payable: false, inputs: [] },
] as const;

export type ArgusGovMethod = (typeof argusGovAbi)[number];
export type ArgusGovWriteName = Extract<ArgusGovMethod, { kind: "write" }>["name"];
export type ArgusGovViewName = Extract<ArgusGovMethod, { kind: "view" }>["name"];

/** Positional argument tuples for every write method. */
export interface ArgusGovWriteArgs {
  register_dao: [daoKey: string];
  claim_guardianship: [daoKey: string];
  withdraw_pool: [daoKey: string, amount: bigint];
  commit_proposal: [daoKey: string, proposalId: bigint, targets: string[], values: bigint[], calldatas: string[], forumUrl: string];
  flag_proposal: [daoKey: string, proposalId: bigint];
  expire_flag: [proposalId: bigint];
  inspect_proposal: [proposalId: bigint];
  execute_circuit_breaker: [proposalId: bigint];
  appeal_flag: [proposalId: bigint];
  resolve_appeal: [proposalId: bigint];
  unfreeze_proposal: [daoKey: string, proposalId: bigint];
  claim_reward: [proposalId: bigint];
  claim_payout: [];
}

// Compile-time guarantee that the argument table covers exactly the write methods in the ABI.
type _WritesCovered = ArgusGovWriteName extends keyof ArgusGovWriteArgs ? (keyof ArgusGovWriteArgs extends ArgusGovWriteName ? true : never) : never;
export const _writesCovered: _WritesCovered = true;
