import { encodeAbiParameters, hexToBytes, keccak256, toBytes } from "viem";

/**
 * keccak256(abi.encode(address[] targets, uint256[] values, bytes[] calldatas, bytes32 keccak256(forumUrl))).
 *
 * This is the commitment ArgusGov stores for a proposal, computed the way a Solidity Governor
 * hashes its proposals. A DAO can recompute it here, or in its own contracts, and compare it
 * with `get_committed_proposal(...).payload_hash` to confirm what was committed.
 */
export function computePayloadHash(targets: string[], values: bigint[], calldatas: string[], forumUrl: string): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint256[]" }, { type: "bytes[]" }, { type: "bytes32" }],
      [targets as `0x${string}`[], values, calldatas as `0x${string}`[], keccak256(toBytes(forumUrl))],
    ),
  );
}

/** A 0x-prefixed 32-byte hash as raw bytes, the form `is_execution_frozen` expects. */
export function payloadHashToBytes(hash: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("A payload hash is 0x followed by 64 hex characters.");
  return hexToBytes(hash as `0x${string}`);
}
