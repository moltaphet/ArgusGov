// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice What a timelock asks before it runs a queued proposal.
interface IExecutionGuard {
    /// @return true when execution of `proposalHash` must be refused right now.
    function isExecutionBlocked(bytes32 proposalHash) external view returns (bool);
}

/// @notice The EVM-side view of ArgusGov's verdicts. ArgusGov lives on GenLayer; a relayer
/// mirrors `is_execution_frozen` and the open-dispute flag for each committed payload hash here
/// (see ArgusGovMirror). `proposalHash` is keccak256(abi.encode(targets, values, calldatas, descriptionHash)).
interface IArgusGov {
    function is_execution_frozen(bytes32 proposalHash) external view returns (bool);
    function is_dispute_open(bytes32 proposalHash) external view returns (bool);
}
