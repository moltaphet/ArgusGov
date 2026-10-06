// Method table for the deployed ArgusGov intelligent contract (contracts/argus_gov.py).
//
// GenLayer contracts are not EVM contracts: there is no Solidity ABI and no
// eth_call. genlayer-js calls them by method name with calldata-encoded
// arguments, so this table describes name, mutability, payability and argument
// types, and drives the typed call signatures below.

export const argusGovAbi = [
  // --- writes ---------------------------------------------------------------
  { name: "register_dao", kind: "write", payable: true, inputs: [{ name: "timelock_address", type: "string" }] },
  {
    name: "flag_proposal", kind: "write", payable: true,
    inputs: [
      { name: "dao_address", type: "string" }, { name: "proposal_id", type: "uint256" },
      { name: "forum_url", type: "string" }, { name: "targets", type: "string[]" }, { name: "calldatas", type: "string[]" },
    ],
  },
  { name: "inspect_proposal", kind: "write", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "execute_circuit_breaker", kind: "write", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "appeal_flag", kind: "write", payable: true, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "resolve_appeal", kind: "write", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "claim_reward", kind: "write", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "claim_payout", kind: "write", payable: false, inputs: [] },
  // --- views ----------------------------------------------------------------
  { name: "solvency", kind: "view", payable: false, inputs: [] },
  { name: "get_ledger", kind: "view", payable: false, inputs: [] },
  { name: "get_proposal", kind: "view", payable: false, inputs: [{ name: "proposal_id", type: "uint256" }] },
  { name: "get_security_pool", kind: "view", payable: false, inputs: [{ name: "dao_address", type: "string" }] },
  { name: "is_execution_frozen", kind: "view", payable: false, inputs: [{ name: "dao_address", type: "string" }, { name: "dao_proposal_id", type: "uint256" }] },
  { name: "get_claimable", kind: "view", payable: false, inputs: [{ name: "who_hex", type: "string" }] },
  { name: "get_cooldown_until", kind: "view", payable: false, inputs: [{ name: "who_hex", type: "string" }] },
] as const;

export type ArgusGovMethod = (typeof argusGovAbi)[number];
export type ArgusGovWriteName = Extract<ArgusGovMethod, { kind: "write" }>["name"];
export type ArgusGovViewName = Extract<ArgusGovMethod, { kind: "view" }>["name"];

/** Positional argument tuples for every write method. */
export interface ArgusGovWriteArgs {
  register_dao: [timelockAddress: string];
  flag_proposal: [daoAddress: string, proposalId: bigint, forumUrl: string, targets: string[], calldatas: string[]];
  inspect_proposal: [proposalId: bigint];
  execute_circuit_breaker: [proposalId: bigint];
  appeal_flag: [proposalId: bigint];
  resolve_appeal: [proposalId: bigint];
  claim_reward: [proposalId: bigint];
  claim_payout: [];
}

// Compile-time guarantee that the argument table covers exactly the write methods in the ABI.
type _WritesCovered = ArgusGovWriteName extends keyof ArgusGovWriteArgs ? (keyof ArgusGovWriteArgs extends ArgusGovWriteName ? true : never) : never;
export const _writesCovered: _WritesCovered = true;
