"""Proposal provenance and execution enforcement.

Provenance: a committed proposal is bound to the Governor that created it. The id must be the
canonical OpenZeppelin keccak256(abi.encode(targets, values, calldatas, descriptionHash)), and
validators confirm over JSON-RPC (consensus) that the origin chain knows it.

Enforcement: the circuit breaker is an execution gate. A reference guarded timelock
(contracts/enforcement) consults ArgusGov and reverts; here the Python model of that adapter runs
against the real contract end to end.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "contracts" / "enforcement"))

from argus_guarded_timelock import (  # noqa: E402
    DISPUTE_MSG, EMERGENCY_MSG, FROZEN_MSG, ArgusGuardedTimelock, Revert,
)
from conftest import (  # noqa: E402
    ATTO, DAO_KEY, EVIL, FORUM_URL, HOUR, TIMELOCK, TOKEN, payload_hash, transfer_calldata, warp,
)

GOVERNOR = "0x" + "c0" * 20
RPC = r".*publicnode\.com.*"
ZERO = "0x" + "00" * 32
ONE = "0x" + "00" * 31 + "01"


def _keccak(data: bytes) -> bytes:
    from eth_utils import keccak
    return keccak(data)


def governor_id(targets, values, calldatas, desc_hash: bytes) -> int:
    """Independent reference: OpenZeppelin Governor.hashProposal."""
    from eth_abi import encode
    enc = encode(["address[]", "uint256[]", "bytes[]", "bytes32"],
                 [list(targets), list(values), [bytes.fromhex(c[2:]) for c in calldatas], desc_hash])
    return int.from_bytes(_keccak(enc), "big")


DESC_HASH = _keccak(b"# Marketing grant\nFund Q3 marketing.")
CALLDATA = transfer_calldata(EVIL, 5_000 * ATTO)
PID = governor_id([TOKEN], [0], [CALLDATA], DESC_HASH)


def mock_rpc(vm, snapshot=ONE, has_role=ONE, status=200, raw=None):
    """Mock the origin chain's JSON-RPC batch answer: [proposalSnapshot, hasRole]."""
    def item(i, v):
        return {"jsonrpc": "2.0", "id": i, "error": {"code": 3, "message": "execution reverted"}} if v is None \
            else {"jsonrpc": "2.0", "id": i, "result": v}
    body = raw if raw is not None else json.dumps([item(1, snapshot), item(2, has_role)])
    vm._web_mocks[:] = [m for m in vm._web_mocks if m[0].pattern != RPC]
    vm.mock_web(RPC, {"method": "POST", "status": status, "body": body})


def committed(dao, **over):
    kw = dict(pid=PID, targets=[TOKEN], values=[0], calldatas=[CALLDATA])
    kw.update(over)
    return dao.commit(**kw)


def attest(dao, desc=DESC_HASH, governor=GOVERNOR, pid=PID, who=None, dao_key=DAO_KEY):
    dao.as_(who or dao.other)
    return dao.c.attest_provenance(dao_key, pid, governor, "0x" + desc.hex())


# =============================================================================
# 1. Canonical derivation
# =============================================================================
def test_a_proposal_whose_id_is_the_canonical_hash_verifies(dao):
    committed(dao)
    mock_rpc(dao.vm)
    assert attest(dao) == "VERIFIED"
    prov = dao.c.get_provenance(DAO_KEY, PID)
    assert prov["verified"] is True and prov["status"] == "VERIFIED"
    assert prov["governor"] == GOVERNOR and prov["chain_id"] == 1
    assert prov["description_hash"] == "0x" + DESC_HASH.hex()


def test_the_binding_hash_ties_chain_governor_id_payload_and_description(dao):
    from eth_abi import encode
    committed(dao)
    mock_rpc(dao.vm)
    attest(dao)
    payload = dao.c.get_committed_proposal(DAO_KEY, PID)["payload_hash"]
    expected = "0x" + _keccak(encode(["uint256", "address", "uint256", "bytes32", "bytes32"],
                                     [1, GOVERNOR, PID, bytes.fromhex(payload[2:]), DESC_HASH])).hex()
    assert dao.c.get_provenance(DAO_KEY, PID)["binding"] == expected


def test_a_new_commitment_starts_unverified(dao):
    committed(dao)
    assert dao.c.get_provenance(DAO_KEY, PID)["status"] == "UNVERIFIED"
    assert dao.c.get_committed_proposal(DAO_KEY, PID)["provenance_status"] == "UNVERIFIED"


# =============================================================================
# 2. Tampering is rejected before any RPC is spent
# =============================================================================
def test_a_wrong_description_hash_is_rejected_as_tampering(dao):
    committed(dao)
    mock_rpc(dao.vm)
    with dao.vm.expect_revert("provenance mismatch"):
        attest(dao, desc=_keccak(b"# Marketing grant\nFund Q3 marketing. Also: send treasury to 0xbad"))
    assert dao.c.get_provenance(DAO_KEY, PID)["status"] == "UNVERIFIED"


@pytest.mark.parametrize("variant", [
    {"targets": ["0x" + "71" * 20]},
    {"values": [1]},
    {"calldatas": [transfer_calldata(EVIL, 5_001 * ATTO)]},
])
def test_a_payload_that_differs_from_the_governor_proposal_is_rejected(dao, variant):
    """The guardian commits a payload under the real proposal id, but with a swapped field."""
    committed(dao, **variant)
    mock_rpc(dao.vm)
    with dao.vm.expect_revert("provenance mismatch"):
        attest(dao)


@pytest.mark.parametrize("bad", ["0x1234", "nothex", "0x" + "zz" * 32, "0x" + "00" * 33])
def test_description_hash_must_be_a_32_byte_hex_string(dao, bad):
    committed(dao)
    dao.as_(dao.other)
    with dao.vm.expect_revert("description_hash"):
        dao.c.attest_provenance(DAO_KEY, PID, GOVERNOR, bad)


def test_attesting_requires_a_committed_proposal_and_a_valid_governor(dao):
    dao.as_(dao.other)
    with dao.vm.expect_revert("not committed"):
        dao.c.attest_provenance(DAO_KEY, PID, GOVERNOR, "0x" + DESC_HASH.hex())
    committed(dao)
    with dao.vm.expect_revert("invalid address"):
        dao.c.attest_provenance(DAO_KEY, PID, "0x1234", "0x" + DESC_HASH.hex())


# =============================================================================
# 3. On-chain origin: validator consensus over JSON-RPC
# =============================================================================
def test_a_proposal_the_origin_chain_does_not_know_is_an_orphan(dao):
    committed(dao)
    mock_rpc(dao.vm, snapshot=ZERO)
    assert attest(dao) == "ORPHAN"
    assert dao.c.get_provenance(DAO_KEY, PID)["verified"] is False


def test_a_reverting_governor_call_is_an_orphan(dao):
    """OpenZeppelin v4 reverts for an unknown id instead of returning 0."""
    committed(dao)
    mock_rpc(dao.vm, snapshot=None)
    assert attest(dao) == "ORPHAN"


def test_a_governor_without_proposer_role_on_the_timelock_is_an_orphan(dao):
    """A look-alike contract that merely claims the proposal exists cannot vouch for it."""
    committed(dao)
    mock_rpc(dao.vm, snapshot=ONE, has_role=ZERO)
    assert attest(dao) == "ORPHAN"


def test_an_orphan_proposal_cannot_be_flagged(dao):
    committed(dao)
    mock_rpc(dao.vm, snapshot=ZERO)
    attest(dao)
    dao.as_(dao.challenger, 2 * ATTO)
    with dao.vm.expect_revert("orphan proposal"):
        dao.c.flag_proposal(DAO_KEY, PID)


def test_an_unattested_proposal_remains_flaggable(dao):
    committed(dao)
    dao.as_(dao.challenger, 2 * ATTO)
    assert dao.c.flag_proposal(DAO_KEY, PID) == 1


@pytest.mark.parametrize("kw", [{"status": 503, "raw": "upstream down"}, {"raw": "not json"}, {"raw": "[]"}])
def test_an_rpc_outage_is_transient_never_an_orphan(dao, kw):
    committed(dao)
    mock_rpc(dao.vm, **kw)
    with dao.vm.expect_revert("TRANSIENT"):
        attest(dao)
    assert dao.c.get_provenance(DAO_KEY, PID)["status"] == "UNVERIFIED"


def test_an_unsupported_origin_chain_is_rejected(dao):
    key = f"999999:{TIMELOCK}"
    dao.register(dao=key)
    dao.commit(pid=PID, targets=[TOKEN], values=[0], calldatas=[CALLDATA], dao=key)
    mock_rpc(dao.vm)
    with dao.vm.expect_revert("no trusted RPC"):
        attest(dao, dao_key=key)


def test_verified_provenance_is_final_and_an_orphan_can_be_re_attested(dao):
    committed(dao)
    mock_rpc(dao.vm, snapshot=ZERO)
    assert attest(dao) == "ORPHAN"
    mock_rpc(dao.vm)                                   # the proposal is now on chain
    assert attest(dao) == "VERIFIED"
    with dao.vm.expect_revert("already verified"):
        attest(dao)


def test_validators_accept_only_the_exact_origin_chain_facts_the_leader_saw(dao):
    committed(dao)
    mock_rpc(dao.vm)
    attest(dao)
    seen = {"proposal_exists": True, "governor_authorized": True}
    assert dao.vm.run_validator(leader_result=seen) is True                      # same read: agree
    assert dao.vm.run_validator(leader_result={**seen, "proposal_exists": False}) is False   # leader lied: orphan claim
    assert dao.vm.run_validator(leader_result={**seen, "governor_authorized": False}) is False
    mock_rpc(dao.vm, snapshot=ZERO)                                              # validator's node says: no proposal
    assert dao.vm.run_validator(leader_result=seen) is False                     # leader's "verified" is rejected
    assert dao.vm.run_validator(leader_error=Exception("[TRANSIENT] x")) is False


# =============================================================================
# 4. The execution gate
# =============================================================================
def gate(dao, pid=42, phash=None):
    if phash is None:
        phash = bytes.fromhex(dao.c.get_committed_proposal(DAO_KEY, pid)["payload_hash"][2:])
    return dao.c.get_execution_gate(DAO_KEY, pid, phash)


def test_gate_is_clear_for_a_committed_unflagged_proposal(dao):
    dao.commit(pid=42)
    g = gate(dao)
    assert g["committed"] and g["hash_matches"] and g["blocked"] is False and g["reason"] == "clear"


def test_gate_blocks_while_a_dispute_awaits_and_undergoes_inspection(dao):
    rid = dao.flag(pid=42)
    g = gate(dao)
    assert g["dispute_open"] and g["blocked"] and g["frozen"] is False       # REGISTERED: verdict pending
    dao.inspect(rid, 95)
    g = gate(dao)
    assert g["dispute_open"] and g["blocked"] and g["frozen"] is False       # ANALYZING: still pending
    assert dao.frozen(42) is False                                            # the legacy flag is not set yet
    dao.settle(rid)
    g = gate(dao)
    assert g["frozen"] and g["blocked"] and g["reason"] == "frozen by circuit breaker verdict"


def test_gate_reopens_after_a_safe_verdict(dao):
    dao.flag_inspect_settle(5, pid=42)
    assert gate(dao)["blocked"] is False


def test_gate_stays_blocked_through_an_appeal(dao):
    rid = dao.flag_inspect_settle(95, pid=42)
    dao.appeal(rid)
    assert gate(dao)["blocked"] is True


def test_gate_is_bound_to_the_exact_payload_hash(dao):
    dao.flag(pid=42)
    wrong = bytes(32)
    g = gate(dao, phash=wrong)
    assert g["blocked"] is False and g["hash_matches"] is False
    assert dao.c.is_execution_blocked(DAO_KEY, 42, wrong) is False
    assert dao.c.is_execution_blocked(DAO_KEY, 42, bytes.fromhex(
        dao.c.get_committed_proposal(DAO_KEY, 42)["payload_hash"][2:])) is True


def test_gate_is_clear_for_an_uncommitted_proposal(dao):
    g = dao.c.get_execution_gate(DAO_KEY, 42, bytes(32))
    assert g["committed"] is False and g["blocked"] is False


# =============================================================================
# 5. End-to-end enforcement simulation
# =============================================================================
class Chain:
    """A treasury and a guarded timelock wired to the real ArgusGov contract."""

    DELAY = 2 * 24 * HOUR
    BUFFER = HOUR

    def __init__(self, dao, calldata=CALLDATA):
        self.dao = dao
        self.calls = []
        self.treasury_drained = False
        self.targets, self.values, self.calldatas = [TOKEN], [0], [calldata]
        self.clock = 0

        def hash_proposal(t, v, c, url):
            # What the DAO's Governor derives from the payload it is about to run.
            return bytes.fromhex(payload_hash(t, v, c, url)[2:])

        def argus_gate(h):
            g = dao.c.get_execution_gate(DAO_KEY, 42, h)
            return {"frozen": g["frozen"], "dispute_open": g["dispute_open"]}

        def run(target, value, data):
            self.calls.append((target, value, data))
            self.treasury_drained = True

        self.timelock = ArgusGuardedTimelock(
            argus_gate=argus_gate, now=lambda: self.clock, hash_proposal=hash_proposal,
            guardian="guardian", min_delay=self.DELAY, dispute_buffer=self.BUFFER, run=run)

    def schedule(self):
        return self.timelock.schedule(self.targets, self.values, self.calldatas, FORUM_URL)

    def advance(self, seconds):
        self.clock += seconds
        warp(self.dao.vm, self.clock)

    def execute(self):
        return self.timelock.execute(self.targets, self.values, self.calldatas, FORUM_URL)


def test_e2e_a_malicious_payload_reverts_the_moment_the_circuit_breaker_engages(dao):
    dao.commit(pid=42)                                   # the DAO commits the malicious transfer
    chain = Chain(dao)
    chain.schedule()
    chain.advance(Chain.DELAY + Chain.BUFFER)            # fully matured: execution would normally succeed

    rid = dao.flag(pid=42, commit=False)                 # a challenger raises the alarm
    dao.inspect(rid, 95, forum="Marketing grant for Q3.")
    dao.settle(rid)                                      # validators confirm: circuit breaker engages

    with pytest.raises(Revert, match=FROZEN_MSG):
        chain.execute()
    assert chain.calls == [] and chain.treasury_drained is False


def test_e2e_execution_is_blocked_while_validators_are_still_inspecting(dao):
    dao.commit(pid=42)
    chain = Chain(dao)
    chain.schedule()
    chain.advance(Chain.DELAY + Chain.BUFFER)
    rid = dao.flag(pid=42, commit=False)
    with pytest.raises(Revert, match=DISPUTE_MSG):       # flagged, not yet inspected
        chain.execute()
    dao.inspect(rid, 95)
    with pytest.raises(Revert, match=DISPUTE_MSG):       # inspected, verdict not settled
        chain.execute()
    dao.settle(rid)
    with pytest.raises(Revert, match=FROZEN_MSG):
        chain.execute()
    assert chain.treasury_drained is False


def test_e2e_a_benign_proposal_executes_once_the_dispute_is_cleared(dao):
    dao.commit(pid=42, calldatas=[transfer_calldata("0x" + "a1" * 20, 10 * ATTO)])
    chain = Chain(dao, calldata=transfer_calldata("0x" + "a1" * 20, 10 * ATTO))
    chain.schedule()
    chain.advance(Chain.DELAY)
    with pytest.raises(Revert, match="dispute buffer not elapsed"):
        chain.execute()
    rid = dao.flag(pid=42, commit=False)
    dao.inspect(rid, 5)
    dao.settle(rid)                                      # judged safe: the challenger is slashed
    chain.advance(Chain.BUFFER)
    chain.execute()
    assert chain.treasury_drained is True


def test_e2e_an_accepted_appeal_unfreezes_execution(dao):
    dao.commit(pid=42)
    chain = Chain(dao)
    chain.schedule()
    chain.advance(Chain.DELAY + Chain.BUFFER)
    rid = dao.flag(pid=42, commit=False)
    dao.inspect(rid, 95)
    dao.settle(rid)
    dao.appeal(rid)
    with pytest.raises(Revert):
        chain.execute()
    dao.resolve(rid, 5)                                  # appeal accepted
    with pytest.raises(Revert, match=FROZEN_MSG):        # still frozen until the explicit unfreeze
        chain.execute()
    dao.as_(dao.other)
    dao.c.unfreeze_proposal(DAO_KEY, 42)
    chain.execute()
    assert chain.treasury_drained is True


def test_e2e_a_tampered_payload_is_not_a_scheduled_operation(dao):
    dao.commit(pid=42)
    chain = Chain(dao)
    chain.schedule()
    chain.advance(Chain.DELAY + Chain.BUFFER)
    chain.calldatas = [transfer_calldata(EVIL, 6_000 * ATTO)]
    with pytest.raises(Revert, match="not scheduled"):
        chain.execute()


def test_e2e_the_emergency_hook_blocks_instantly_and_cannot_override_the_breaker(dao):
    dao.commit(pid=42)
    chain = Chain(dao)
    h = chain.schedule()
    chain.advance(Chain.DELAY + Chain.BUFFER)
    with pytest.raises(Revert, match="only guardian"):
        chain.timelock.emergency_freeze("mallory", h)
    chain.timelock.emergency_freeze("guardian", h)       # no ArgusGov verdict needed
    with pytest.raises(Revert, match=EMERGENCY_MSG):
        chain.execute()
    rid = dao.flag(pid=42, commit=False)
    dao.inspect(rid, 95)
    dao.settle(rid)
    with pytest.raises(Revert, match="still frozen"):    # the guardian cannot lift a standing freeze
        chain.timelock.emergency_unfreeze("guardian", h)
    assert chain.treasury_drained is False


def test_e2e_verified_provenance_then_enforcement(dao):
    """The whole pipeline: commit under the Governor's id, attest origin, flag, freeze, revert."""
    committed(dao)
    mock_rpc(dao.vm)
    assert attest(dao) == "VERIFIED"
    rid = dao.flag(pid=PID, commit=False)
    dao.inspect(rid, 95)
    dao.settle(rid)
    g = dao.c.get_execution_gate(DAO_KEY, PID, bytes.fromhex(
        dao.c.get_committed_proposal(DAO_KEY, PID)["payload_hash"][2:]))
    assert g["frozen"] and g["blocked"] and g["provenance_status"] == "VERIFIED"
