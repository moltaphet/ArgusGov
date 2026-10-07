"""Executable reference model of ArgusGuardedTimelock.sol.

It mirrors the Solidity adapter line for line so the enforcement path can be simulated end to end
against the real ArgusGov contract in the direct-mode test harness (tests/test_provenance_enforcement.py).
`argus_gate(proposal_hash) -> dict` stands in for the relayer-mirrored ArgusGov state; in the tests it
queries `ArgusGov.get_execution_gate` directly.
"""

from dataclasses import dataclass, field
from typing import Callable

FROZEN_MSG = "ArgusGov: Execution frozen by circuit breaker"
DISPUTE_MSG = "ArgusGov: Dispute inspection in progress"
EMERGENCY_MSG = "ArgusGov: Emergency freeze active"


class Revert(Exception):
    """An EVM revert with its reason string."""


@dataclass
class Operation:
    eta: int = 0
    executed: bool = False
    cancelled: bool = False


@dataclass
class ArgusGuardedTimelock:
    argus_gate: Callable[[bytes], dict]       # proposal hash -> {"frozen": bool, "dispute_open": bool}
    now: Callable[[], int]
    hash_proposal: Callable[[list, list, list, str], bytes]
    guardian: str
    min_delay: int
    dispute_buffer: int
    run: Callable[[str, int, str], None]       # the external call: (target, value, calldata)
    operations: dict = field(default_factory=dict)
    emergency_frozen: set = field(default_factory=set)

    def schedule(self, targets, values, calldatas, forum_url) -> bytes:
        h = self.hash_proposal(targets, values, calldatas, forum_url)
        if h in self.operations:
            raise Revert("already scheduled")
        self.operations[h] = Operation(eta=self.now() + self.min_delay)
        return h

    def is_execution_blocked(self, h: bytes) -> bool:
        gate = self.argus_gate(h)
        return h in self.emergency_frozen or gate["frozen"] or gate["dispute_open"]

    def execute(self, targets, values, calldatas, forum_url) -> None:
        h = self.hash_proposal(targets, values, calldatas, forum_url)
        op = self.operations.get(h)
        if op is None or op.cancelled:
            raise Revert("not scheduled")
        if op.executed:
            raise Revert("already executed")
        if self.now() < op.eta + self.dispute_buffer:
            raise Revert("timelock: delay and dispute buffer not elapsed")
        gate = self.argus_gate(h)  # the enforcement gate, immediately before any external call
        if h in self.emergency_frozen:
            raise Revert(EMERGENCY_MSG)
        if gate["frozen"]:
            raise Revert(FROZEN_MSG)
        if gate["dispute_open"]:
            raise Revert(DISPUTE_MSG)
        op.executed = True
        for t, v, c in zip(targets, values, calldatas):
            self.run(t, v, c)

    def emergency_freeze(self, sender: str, h: bytes) -> None:
        if sender != self.guardian:
            raise Revert("only guardian")
        self.emergency_frozen.add(h)

    def emergency_unfreeze(self, sender: str, h: bytes) -> None:
        if sender != self.guardian:
            raise Revert("only guardian")
        gate = self.argus_gate(h)
        if gate["frozen"]:
            raise Revert("ArgusGov: still frozen")
        if gate["dispute_open"]:
            raise Revert("ArgusGov: dispute open")
        self.emergency_frozen.discard(h)
