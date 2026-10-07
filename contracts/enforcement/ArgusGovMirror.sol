// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IArgusGov} from "./IExecutionGuard.sol";

/// @notice Reference mirror of ArgusGov's circuit-breaker state on the DAO's chain. Only the
/// GenLayer bridge relayer may write; anyone can read. In production the relayer is the
/// GenLayer -> EVM message bridge, which delivers ArgusGov's finalized `is_execution_blocked` result.
contract ArgusGovMirror is IArgusGov {
    address public immutable relayer;
    mapping(bytes32 => bool) private _frozen;
    mapping(bytes32 => bool) private _disputeOpen;

    event StateRelayed(bytes32 indexed proposalHash, bool frozen, bool disputeOpen);

    constructor(address relayer_) {
        relayer = relayer_;
    }

    function relay(bytes32 proposalHash, bool frozen, bool disputeOpen) external {
        require(msg.sender == relayer, "ArgusGovMirror: only relayer");
        _frozen[proposalHash] = frozen;
        _disputeOpen[proposalHash] = disputeOpen;
        emit StateRelayed(proposalHash, frozen, disputeOpen);
    }

    function is_execution_frozen(bytes32 proposalHash) external view returns (bool) {
        return _frozen[proposalHash];
    }

    function is_dispute_open(bytes32 proposalHash) external view returns (bool) {
        return _disputeOpen[proposalHash];
    }
}
