// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ArgusGuardedTimelock} from "../ArgusGuardedTimelock.sol";
import {ArgusGovMirror} from "../ArgusGovMirror.sol";
import {IArgusGov} from "../IExecutionGuard.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert(bytes calldata) external;
    function deal(address, uint256) external;
}

contract Treasury {
    address public owner;
    constructor(address owner_) { owner = owner_; }
    function drain(address to) external { require(msg.sender == owner, "not owner"); payable(to).transfer(address(this).balance); }
    receive() external payable {}
}

/// Run with `forge test` from contracts/enforcement (cheatcodes only, no forge-std needed).
contract ArgusGuardedTimelockTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    address constant GUARDIAN = address(0xA11CE);
    address constant RELAYER = address(0xB0B);
    address constant ATTACKER = address(0xBAD);
    uint256 constant DELAY = 2 days;
    uint256 constant BUFFER = 1 hours;

    ArgusGovMirror mirror;
    ArgusGuardedTimelock timelock;
    Treasury treasury;
    address[] targets;
    uint256[] values;
    bytes[] datas;
    bytes32 constant DESC = keccak256("Marketing grant");

    function setUp() public {
        mirror = new ArgusGovMirror(RELAYER);
        timelock = new ArgusGuardedTimelock(IArgusGov(address(mirror)), GUARDIAN, DELAY, BUFFER);
        treasury = new Treasury(address(timelock));
        vm.deal(address(treasury), 100 ether);
        targets.push(address(treasury));
        values.push(0);
        datas.push(abi.encodeCall(Treasury.drain, (ATTACKER)));
    }

    function _schedule() internal returns (bytes32 h) {
        h = timelock.schedule(targets, values, datas, DESC);
        vm.warp(block.timestamp + DELAY + BUFFER);
    }

    function testBenignProposalExecutesAfterDelayAndBuffer() public {
        bytes32 h = timelock.schedule(targets, values, datas, DESC);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert("timelock: delay and dispute buffer not elapsed");
        timelock.execute(targets, values, datas, DESC);
        vm.warp(block.timestamp + BUFFER);
        timelock.execute(targets, values, datas, DESC);
        (, bool executed,) = timelock.operations(h);
        require(ATTACKER.balance == 100 ether && executed, "should execute");
    }

    function testMaliciousExecutionRevertsOnceCircuitBreakerEngages() public {
        bytes32 h = _schedule();
        vm.prank(RELAYER);
        mirror.relay(h, true, false);
        vm.expectRevert("ArgusGov: Execution frozen by circuit breaker");
        timelock.execute(targets, values, datas, DESC);
        require(address(treasury).balance == 100 ether, "treasury untouched");
    }

    function testExecutionBlockedWhileDisputeIsBeingInspected() public {
        bytes32 h = _schedule();
        vm.prank(RELAYER);
        mirror.relay(h, false, true);
        vm.expectRevert("ArgusGov: Dispute inspection in progress");
        timelock.execute(targets, values, datas, DESC);
    }

    function testEmergencyFreezeInterceptsAndCannotOverrideTheBreaker() public {
        bytes32 h = _schedule();
        vm.prank(GUARDIAN);
        timelock.emergencyFreeze(h);
        vm.expectRevert("ArgusGov: Emergency freeze active");
        timelock.execute(targets, values, datas, DESC);
        vm.prank(RELAYER);
        mirror.relay(h, true, false);
        vm.prank(GUARDIAN);
        vm.expectRevert("ArgusGov: still frozen");
        timelock.emergencyUnfreeze(h);
    }

    function testTamperedPayloadIsADifferentUnscheduledOperation() public {
        _schedule();
        datas[0] = abi.encodeCall(Treasury.drain, (address(0xC0FFEE)));
        vm.expectRevert("not scheduled");
        timelock.execute(targets, values, datas, DESC);
    }
}
