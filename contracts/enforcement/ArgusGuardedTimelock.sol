// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IArgusGov, IExecutionGuard} from "./IExecutionGuard.sol";

/// @notice Reference timelock whose `execute` is gated by ArgusGov. It is deliberately small and
/// dependency-free: a DAO on OpenZeppelin's TimelockController wires the same check into an
/// executor wrapper or a custom `_beforeCall`. Execution is refused when
///   - ArgusGov's circuit breaker froze the proposal            (verdict reached),
///   - a dispute is still being inspected by GenLayer validators (verdict pending), or
///   - the guardian pulled the local emergency brake,
/// and, even when none applies, no earlier than `disputeBuffer` after the delay has elapsed, so a
/// challenge raised at the last moment has time to be relayed before the proposal can run.
contract ArgusGuardedTimelock is IExecutionGuard {
    IArgusGov public immutable argusGov;
    address public immutable guardian;
    uint256 public immutable minDelay;
    /// @notice Extra wait after the delay: covers challenge-to-relay latency and the 30-minute
    /// challenger inspection window.
    uint256 public immutable disputeBuffer;

    struct Operation {
        uint256 eta;
        bool executed;
        bool cancelled;
    }

    mapping(bytes32 => Operation) public operations;
    mapping(bytes32 => bool) public emergencyFrozen;

    event Scheduled(bytes32 indexed proposalHash, uint256 eta);
    event Executed(bytes32 indexed proposalHash);
    event Cancelled(bytes32 indexed proposalHash);
    event EmergencyFreeze(bytes32 indexed proposalHash, address indexed by);
    event EmergencyUnfreeze(bytes32 indexed proposalHash, address indexed by);

    constructor(IArgusGov argusGov_, address guardian_, uint256 minDelay_, uint256 disputeBuffer_) {
        argusGov = argusGov_;
        guardian = guardian_;
        minDelay = minDelay_;
        disputeBuffer = disputeBuffer_;
    }

    /// @notice keccak256(abi.encode(targets, values, calldatas, descriptionHash)): the OpenZeppelin
    /// Governor proposal id, and the hash ArgusGov commits and freezes.
    function hashProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(targets, values, calldatas, descriptionHash));
    }

    function schedule(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 descriptionHash
    ) external returns (bytes32 proposalHash) {
        require(targets.length == values.length && targets.length == calldatas.length, "length mismatch");
        proposalHash = hashProposal(targets, values, calldatas, descriptionHash);
        require(operations[proposalHash].eta == 0, "already scheduled");
        uint256 eta = block.timestamp + minDelay;
        operations[proposalHash].eta = eta;
        emit Scheduled(proposalHash, eta);
    }

    function isExecutionBlocked(bytes32 proposalHash) public view returns (bool) {
        return emergencyFrozen[proposalHash] || argusGov.is_execution_frozen(proposalHash)
            || argusGov.is_dispute_open(proposalHash);
    }

    function earliestExecution(bytes32 proposalHash) public view returns (uint256) {
        uint256 eta = operations[proposalHash].eta;
        return eta == 0 ? 0 : eta + disputeBuffer;
    }

    function execute(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 descriptionHash
    ) external payable {
        bytes32 proposalHash = hashProposal(targets, values, calldatas, descriptionHash);
        Operation storage op = operations[proposalHash];
        require(op.eta != 0 && !op.cancelled, "not scheduled");
        require(!op.executed, "already executed");
        require(block.timestamp >= op.eta + disputeBuffer, "timelock: delay and dispute buffer not elapsed");

        // The enforcement gate: checked last, immediately before any external call.
        require(!emergencyFrozen[proposalHash], "ArgusGov: Emergency freeze active");
        require(!argusGov.is_execution_frozen(proposalHash), "ArgusGov: Execution frozen by circuit breaker");
        require(!argusGov.is_dispute_open(proposalHash), "ArgusGov: Dispute inspection in progress");

        op.executed = true;
        for (uint256 i = 0; i < targets.length; i++) {
            (bool ok,) = targets[i].call{value: values[i]}(calldatas[i]);
            require(ok, "timelock: call reverted");
        }
        emit Executed(proposalHash);
    }

    /// @notice Emergency interception hook: the guardian blocks a proposal instantly, without waiting
    /// for the GenLayer verdict to be relayed.
    function emergencyFreeze(bytes32 proposalHash) external {
        require(msg.sender == guardian, "only guardian");
        emergencyFrozen[proposalHash] = true;
        emit EmergencyFreeze(proposalHash, msg.sender);
    }

    /// @notice Lift the local brake. Refused while ArgusGov still holds a freeze or open dispute, so the
    /// guardian cannot override the circuit breaker.
    function emergencyUnfreeze(bytes32 proposalHash) external {
        require(msg.sender == guardian, "only guardian");
        require(!argusGov.is_execution_frozen(proposalHash), "ArgusGov: still frozen");
        require(!argusGov.is_dispute_open(proposalHash), "ArgusGov: dispute open");
        emergencyFrozen[proposalHash] = false;
        emit EmergencyUnfreeze(proposalHash, msg.sender);
    }

    function cancel(bytes32 proposalHash) external {
        require(msg.sender == guardian, "only guardian");
        require(operations[proposalHash].eta != 0 && !operations[proposalHash].executed, "nothing to cancel");
        operations[proposalHash].cancelled = true;
        emit Cancelled(proposalHash);
    }

    receive() external payable {}
}
