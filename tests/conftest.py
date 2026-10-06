"""Fixtures, mock validators and calldata generators for the ArgusGov suite.

Uses the genlayer-test direct-mode plugin fixtures (direct_vm, direct_deploy,
direct_alice, ...). Everything runs in memory; no network is touched.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

CONTRACT = "contracts/argus_gov.py"

ATTO = 10**18
BOND = 2 * ATTO
APPEAL_BOND = 4 * ATTO
POOL = 100 * ATTO
HOUR = 3600
T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

CHAIN_ID = 1
TIMELOCK = "0x" + "d1" * 20
DAO_KEY = f"{CHAIN_ID}:{TIMELOCK}"
TOKEN = "0x" + "70" * 20
PROXY = "0x" + "9a" * 20
EVIL = "0x" + "ee" * 20
FORUM_URL = "https://forum.example-dao.org/t/proposal-42"


# --------------------------------------------------------------------- calldata
def _word_addr(addr: str) -> str:
    return addr[2:].rjust(64, "0")


def _word_int(n: int) -> str:
    return format(n, "064x")


def transfer_calldata(to: str, amount: int) -> str:
    return "0x" + "a9059cbb" + _word_addr(to) + _word_int(amount)


def approve_calldata(spender: str, amount: int) -> str:
    return "0x" + "095ea7b3" + _word_addr(spender) + _word_int(amount)


def mint_calldata(to: str, amount: int) -> str:
    return "0x" + "40c10f19" + _word_addr(to) + _word_int(amount)


def upgrade_to_calldata(impl: str) -> str:
    return "0x" + "3659cfe6" + _word_addr(impl)


def transfer_ownership_calldata(new_owner: str) -> str:
    return "0x" + "f2fde38b" + _word_addr(new_owner)


def payload_hash(targets, values, calldatas, forum_url) -> str:
    """Independent reference for the contract's commitment hash: Solidity
    keccak256(abi.encode(address[], uint256[], bytes[], bytes32)) as Governor contracts use it."""
    from eth_abi import encode
    from eth_utils import keccak

    desc = keccak(text=forum_url)
    encoded = encode(
        ["address[]", "uint256[]", "bytes[]", "bytes32"],
        [list(targets), list(values), [bytes.fromhex(c[2:]) for c in calldatas], desc],
    )
    return "0x" + keccak(encoded).hex()


def unknown_calldata() -> str:
    return "0x" + "deadbeef" + _word_int(1)


# ------------------------------------------------------------------ LLM / web mocks
def mock_forum(direct_vm, text: str, status: int = 200) -> None:
    direct_vm.mock_web(r".*forum\.example-dao\.org.*", {"status": status, "body": f"<html><body><p>{text}</p></body></html>"})


def mock_verdict(direct_vm, score: int, is_malicious=None, reasoning: str = "Analysis complete.") -> None:
    """Pin the validators' LLM answer. The payload is double-encoded because the
    harness json.loads() the mock once and exec_prompt(response_format="json")
    decodes the resulting string a second time."""
    if is_malicious is None:
        is_malicious = score >= 75
    payload = {"score": score, "reasoning": reasoning, "is_malicious": is_malicious}
    set_llm(direct_vm, r".*", payload)


def set_llm(direct_vm, pattern: str, payload) -> None:
    """Replace every LLM mock. mock_llm() only appends and the first match wins,
    so a later verdict would otherwise be shadowed by an earlier one."""
    direct_vm._llm_mocks.clear()
    direct_vm._llm_mocks_hit.clear()
    direct_vm.mock_llm(pattern, json.dumps(json.dumps(payload)))


def warp(direct_vm, seconds_after_t0: int) -> None:
    direct_vm.warp((T0 + timedelta(seconds=seconds_after_t0)).strftime("%Y-%m-%dT%H:%M:%SZ"))


# ---------------------------------------------------------------------- helpers
class Env:
    """Bundles a deployed contract with the accounts used by every test."""

    def __init__(self, vm, contract, guardian, challenger, other):
        self.vm = vm
        self.c = contract
        self.guardian = guardian
        self.challenger = challenger
        self.other = other
        self.deposited = 0  # independent tally: value in minus value out
        self._pid = 42      # next auto-assigned DAO proposal id
        self.last_hash = ""

    def as_(self, who, value: int = 0):
        self.vm.sender = who
        self.vm.value = value

    def key(self, who) -> str:
        self.as_(who)
        return self.c.whoami()

    def register(self, stake: int = POOL, dao: str = DAO_KEY):
        self.as_(self.guardian, stake)
        self.c.register_dao(dao)
        self.deposited += stake
        self.as_(self.guardian)

    def commit(self, pid=None, targets=None, values=None, calldatas=None, dao: str = DAO_KEY,
               url: str = FORUM_URL, who=None) -> int:
        """Commit a proposal payload as the DAO guardian (or `who`). Returns the proposal id used."""
        if pid is None:
            pid = self._pid
            self._pid += 1
        targets = targets if targets is not None else [TOKEN]
        calldatas = calldatas if calldatas is not None else [transfer_calldata(EVIL, 5_000 * ATTO)]
        values = values if values is not None else [0] * len(targets)
        self.as_(who or self.guardian)
        self.last_hash = self.c.commit_proposal(dao, pid, targets, values, calldatas, url)
        return pid

    def flag(self, who=None, pid=None, targets=None, values=None, calldatas=None, dao: str = DAO_KEY,
             url: str = FORUM_URL, value: int = BOND, commit: bool = True) -> int:
        """Commit a payload (unless `commit` is False) and flag it. Returns the ArgusGov record id."""
        if commit:
            pid = self.commit(pid, targets, values, calldatas, dao, url)
        elif pid is None:
            raise ValueError("pid is required when commit=False")
        self.as_(who or self.challenger, value)
        rid = self.c.flag_proposal(dao, pid)
        self.deposited += value
        self.as_(who or self.challenger)
        return rid

    def inspect(self, rid: int, score: int, forum: str = "Marketing grant.", caller=None):
        mock_forum(self.vm, forum)
        mock_verdict(self.vm, score)
        self.as_(caller or self.other)
        return self.c.inspect_proposal(rid)

    def settle(self, rid: int, caller=None) -> str:
        self.as_(caller or self.other)
        return self.c.execute_circuit_breaker(rid)

    def flag_inspect_settle(self, score: int, **kw) -> int:
        rid = self.flag(**kw)
        self.inspect(rid, score)
        self.settle(rid)
        return rid

    def appeal(self, rid: int, value: int = APPEAL_BOND, who=None):
        self.as_(who or self.guardian, value)
        self.c.appeal_flag(rid)
        self.deposited += value
        self.as_(who or self.guardian)

    def resolve(self, rid: int, score: int) -> str:
        mock_verdict(self.vm, score)
        mock_forum(self.vm, "Re-read.")
        self.as_(self.other)
        return self.c.resolve_appeal(rid)

    def claimable(self, who) -> int:
        return self.c.get_claimable(self.key(who))

    def stake(self, dao: str = DAO_KEY) -> int:
        return self.c.get_security_pool(dao)["stake"]

    def payout(self, who) -> int:
        self.as_(who)
        amount = self.c.claim_payout()
        self.deposited -= amount
        return amount

    def owed(self) -> int:
        ledger = self.c.get_ledger()
        return (ledger["total_pool"] + ledger["total_escrow"]
                + ledger["total_claimable"] + ledger["burn_vault"])

    def assert_conserved(self):
        """Every unit of value held is in exactly one bucket. The direct harness
        does not credit msg.value to the contract balance, so the invariant is
        checked against an independent deposits-minus-payouts tally (on a real
        chain the same equality is exposed by solvency())."""
        assert self.owed() == self.deposited, (self.c.get_ledger(), self.deposited)


@pytest.fixture
def env(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    warp(direct_vm, 0)
    contract = direct_deploy(CONTRACT)
    return Env(direct_vm, contract, direct_alice, direct_bob, direct_charlie)


@pytest.fixture
def dao(env):
    env.register()
    return env
