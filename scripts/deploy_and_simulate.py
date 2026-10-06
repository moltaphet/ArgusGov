#!/usr/bin/env python3
"""Deploy ArgusGov and replay real attack shapes against it.

Two modes:

  direct   (default) In-memory GenVM. Deterministic validators are mocked, so it
           needs no network and finishes in seconds. It replays three scenarios
           (safe proposal, hidden treasury drain, malicious proxy upgrade with a
           failed appeal) and prints the resulting ledger.

  network  Deploys to GenLayer Studio Next (chain 61997) with genlayer-py and runs the
           hidden-drain scenario through REAL validator consensus, recording
           telemetry to deployments/studio-next.json. Keys come from GUARDIAN_KEY /
           CHALLENGER_KEY (environment or the git-ignored .env.studio). The default
           forum page (https://example.com) declares no treasury transfer at all, so a
           9,999,999-token drain is an undisclosed action; point --forum-url at your
           own page to test a "small marketing grant" description.

Usage:
    python scripts/deploy_and_simulate.py              # direct mode
    python scripts/deploy_and_simulate.py --mode network [--forum-url URL]
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contracts" / "argus_gov.py"

ATTO = 10**18
BOND = 2 * ATTO
POOL = 100 * ATTO
TIMELOCK = "0x" + "d1" * 20
CHAIN_ID = 61997
DAO_KEY = f"{CHAIN_ID}:{TIMELOCK}"
TOKEN = "0x" + "70" * 20
PROXY = "0x" + "9a" * 20
ATTACKER = "0x" + "ee" * 20
T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def transfer_calldata(to: str, amount: int) -> str:
    return "0x" + "a9059cbb" + to[2:].rjust(64, "0") + format(amount, "064x")


def upgrade_calldata(impl: str) -> str:
    return "0x" + "3659cfe6" + impl[2:].rjust(64, "0")


def fmt(wei: int) -> str:
    return f"{wei / ATTO:,.4f} GEN"


# =============================================================================
# direct mode
# =============================================================================
def run_direct() -> int:
    from gltest.direct.loader import create_address, deploy_contract
    from gltest.direct.vm import VMContext

    vm = VMContext()
    guardian = create_address("guardian")
    challenger = create_address("challenger")
    keeper = create_address("keeper")
    vm.sender = guardian

    def at(seconds: int) -> None:
        vm.warp((T0 + timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"))

    def validators(score: int, forum_text: str, reasoning: str) -> None:
        vm._llm_mocks.clear()
        vm._web_mocks.clear()
        vm.mock_web(r".*", {"status": 200, "body": f"<html><body>{forum_text}</body></html>"})  # type: ignore[arg-type]
        verdict = {"score": score, "reasoning": reasoning, "is_malicious": score >= 75}
        vm.mock_llm(r".*", json.dumps(json.dumps(verdict)))

    def call(who, value=0):
        vm.sender, vm.value = who, value

    def banner(title: str) -> None:
        print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")

    def ledger(c) -> None:
        led = c.get_ledger()
        print(f"  pool={fmt(led['total_pool'])}  escrow={fmt(led['total_escrow'])}  "
              f"claimable={fmt(led['total_claimable'])}  burned={fmt(led['burn_vault'])}")

    with vm.activate():
        at(0)
        argus = deploy_contract(CONTRACT, vm)
        banner("DEPLOY  ArgusGov deployed in-memory; DAO guardian registers a 100 GEN security pool")
        call(guardian, POOL)
        argus.register_dao(DAO_KEY)
        ledger(argus)

        # --- Scenario 1: honest proposal, griefing challenger -----------------
        banner("SCENARIO 1  Honest proposal. A griefer flags it anyway.")
        call(guardian)
        argus.commit_proposal(DAO_KEY, 101, [TOKEN], [0], [transfer_calldata("0x" + "a1" * 20, 5_000 * ATTO)],
                              "https://forum.dao.example/t/101")
        call(challenger, BOND)
        rid = argus.flag_proposal(DAO_KEY, 101)
        validators(6, "Marketing grant: transfer 5,000 tokens to the growth guild.",
                   "Calldata transfers exactly the 5,000 tokens the post describes.")
        call(keeper)
        score = argus.inspect_proposal(rid)
        status = argus.execute_circuit_breaker(rid)
        print(f"  consensus score={score} -> {status}")
        call(challenger)
        until = argus.get_cooldown_until(argus.whoami())
        print(f"  challenger bond slashed; locked out of flagging until {until} (unix, +4h)")
        ledger(argus)

        # --- Scenario 2: hidden treasury drain --------------------------------
        banner("SCENARIO 2  Hidden drain: 'marketing grant of 5k tokens' executes transfer(treasury)")
        at(5 * 3600)
        call(guardian)
        argus.commit_proposal(DAO_KEY, 102, [TOKEN], [0], [transfer_calldata(ATTACKER, 9_999_999 * ATTO)],
                              "https://forum.dao.example/t/102")
        call(challenger, BOND)
        rid = argus.flag_proposal(DAO_KEY, 102)
        validators(97, "Marketing grant of 5k tokens for the Q3 campaign.",
                   "Post declares a 5k grant; calldata moves 9,999,999 tokens to an unknown address.")
        call(keeper)
        score = argus.inspect_proposal(rid)
        status = argus.execute_circuit_breaker(rid)
        print(f"  consensus score={score} -> {status}")
        committed_hash = bytes.fromhex(argus.get_committed_proposal(DAO_KEY, 102)["payload_hash"][2:])
        print(f"  execution frozen for DAO proposal 102 (guard passes the committed hash): "
              f"{argus.is_execution_frozen(DAO_KEY, 102, committed_hash)}")
        print(f"  ...and for a different payload hash: {argus.is_execution_frozen(DAO_KEY, 102, bytes(32))}")
        ledger(argus)
        at(5 * 3600 + 24 * 3600)
        call(challenger)
        paid = argus.claim_reward(rid)
        print(f"  appeal window closed unchallenged; challenger vested {fmt(paid)} "
              f"(refunded bond + 10% bounty)")
        ledger(argus)

        # --- Scenario 3: proxy upgrade, DAO appeals and loses -----------------
        banner("SCENARIO 3  'Minor gas patch' repoints the proxy; guardian appeals and loses")
        at(2 * 24 * 3600)
        call(guardian)
        argus.commit_proposal(DAO_KEY, 103, [PROXY], [0], [upgrade_calldata(ATTACKER)],
                              "https://forum.dao.example/t/103")
        call(challenger, BOND)
        rid = argus.flag_proposal(DAO_KEY, 103)
        validators(94, "Minor gas optimisation patch. No behavioural change.",
                   "upgradeTo() points the proxy at an unverified implementation.")
        call(keeper)
        argus.inspect_proposal(rid)
        argus.execute_circuit_breaker(rid)
        call(guardian, 2 * BOND)
        argus.appeal_flag(rid)
        print(f"  guardian posted a {fmt(2 * BOND)} appeal bond -> "
              f"{argus.get_proposal(rid)['status']}")
        validators(91, "Minor gas optimisation patch. No behavioural change.",
                   "Re-analysis confirms the implementation swap.")
        call(keeper)
        outcome = argus.resolve_appeal(rid)
        print(f"  fresh consensus -> {outcome}; appellant bond split challenger/burn vault")
        ledger(argus)

    print("\nDone: 3 scenarios replayed. See README.md for the threat model.")
    return 0


# =============================================================================
# network mode
# =============================================================================
STUDIO_NEXT_RPC = "https://studio-next.genlayer.com/api"
STUDIO_NEXT_EXPLORER = "https://explorer-studio-next.genlayer.com"
DEPLOYMENT_FILE = ROOT / "deployments" / "studio-next.json"
ENV_FILE = ROOT / ".env.studio"


def _load_keys() -> dict:
    """GUARDIAN_KEY / CHALLENGER_KEY from the environment, else from the
    git-ignored .env.studio file. Keys are never printed or recorded."""
    keys = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                name, value = line.split("=", 1)
                keys[name.strip()] = value.strip()
    for name in ("GUARDIAN_KEY", "CHALLENGER_KEY"):
        keys[name] = os.environ.get(name) or keys.get(name, "")
        if not keys[name]:
            sys.exit(f"{name} is required (environment or {ENV_FILE.name})")
    return keys


def _receipt_address(receipt) -> str:
    """Contract address from a deploy receipt (decoded data first, then data)."""
    for container in (receipt.get("tx_data_decoded"), receipt.get("txDataDecoded"),
                      receipt.get("data")):
        if isinstance(container, dict):
            for key in ("contract_address", "contractAddress"):
                if container.get(key):
                    return container[key]
    return ""


def _consensus_proof(receipt) -> dict:
    """Compact evidence of validator consensus: who voted and how, and the
    decision the chain accepted. Timing traces and raw blobs are left out."""
    last = receipt.get("last_round") or {}
    decision = (receipt.get("consensus_history") or {}).get("latestDecision") or {}
    return {
        "result": receipt.get("result_name"),
        "decision": decision.get("status"),
        "appeal_deadline": decision.get("appealDeadline"),
        "initial_validators": receipt.get("num_of_initial_validators"),
        "round": last.get("round"),
        "leader_index": last.get("leader_index"),
        "votes_committed": last.get("votes_committed"),
        "votes_revealed": last.get("votes_revealed"),
        "rotations_left": last.get("rotations_left"),
        "validators": last.get("round_validators"),
        "votes": last.get("validator_votes_name"),
        "votes_hash": last.get("validator_votes_hash"),
    }


def run_network(endpoint: str, forum_url: str) -> int:
    from eth_account import Account
    from genlayer_py import create_client
    from genlayer_py.chains import studio_devnet

    keys = _load_keys()
    guardian = Account.from_key(keys["GUARDIAN_KEY"])
    challenger = Account.from_key(keys["CHALLENGER_KEY"])
    client = create_client(chain=studio_devnet, endpoint=endpoint, account=guardian)
    chain_id = client.chain.id
    if chain_id != 61997:
        sys.exit(f"unexpected chain id {chain_id}; Studio Next is 61997")

    record = {
        "network": "studio-next",
        "chain_id": chain_id,
        "rpc_url": endpoint,
        "explorer_url": STUDIO_NEXT_EXPLORER,
        "source": "contracts/argus_gov.py",
        "source_sha256": hashlib.sha256(CONTRACT.read_bytes()).hexdigest(),
        "guardian": guardian.address,
        "challenger": challenger.address,
        "forum_url": forum_url,
        "contract_address": "",
        "transactions": [],
    }

    def save() -> None:
        DEPLOYMENT_FILE.parent.mkdir(exist_ok=True)
        DEPLOYMENT_FILE.write_text(json.dumps(record, indent=2, default=str) + "\n")

    def settle(label: str, tx_hash: str, proposal_id: int = 0) -> dict:
        receipt = client.wait_for_transaction_receipt(
            transaction_hash=tx_hash, wait_until="decided", retries=200, interval=3000,
            full_transaction=True)
        execution = receipt.get("tx_execution_result_name") or receipt.get("txExecutionResultName")
        leader = ((receipt.get("consensus_data") or {}).get("leader_receipt") or [{}])[0]
        entry = {"label": label, "tx_hash": tx_hash, "proposal_id": proposal_id or None,
                 "execution": execution,
                 "revert_message": (leader.get("result") or {}).get("payload") if execution != "FINISHED_WITH_RETURN" else None,
                 "explorer_url": f"{STUDIO_NEXT_EXPLORER}/transactions/{tx_hash}",
                 "consensus": _consensus_proof(receipt)}
        record["transactions"].append(entry)
        save()
        print(f"  {label}: {tx_hash}  status={receipt.get('status_name')} "
              f"result={receipt.get('result_name')}")
        return receipt

    def send(label, fn, args, who, value=0, proposal_id=0):
        fees = client.estimate_transaction_fees()
        tx = client.write_contract(address=record["contract_address"], function_name=fn,
                                   args=args, account=who, value=value, fees=fees)
        return settle(label, tx, proposal_id)

    def read(fn, args):
        return client.read_contract(address=record["contract_address"], function_name=fn,
                                    args=args)

    print(f"Deploying ArgusGov to Studio Next (chain {chain_id}) as {guardian.address}")
    fees = client.estimate_transaction_fees()
    tx = client.deploy_contract(code=CONTRACT.read_bytes(), account=guardian, args=[], fees=fees)
    receipt = settle("deploy", tx)
    address = _receipt_address(receipt)
    if not address:
        sys.exit("deployment receipt carried no contract address")
    record["contract_address"] = address
    record["address_explorer_url"] = f"{STUDIO_NEXT_EXPLORER}/address/{address}"
    save()
    print(f"  contract: {address}")

    calldata = transfer_calldata(ATTACKER, 9_999_999 * ATTO)
    send("register_dao", "register_dao", [DAO_KEY], guardian, POOL)
    send("commit_proposal", "commit_proposal", [DAO_KEY, 1, [TOKEN], [0], [calldata], forum_url], guardian, proposal_id=1)
    # Negative test: a challenger cannot flag a proposal the DAO never committed.
    send("flag_uncommitted_rejected", "flag_proposal", [DAO_KEY, 999], challenger, BOND)
    send("flag_proposal", "flag_proposal", [DAO_KEY, 1], challenger, BOND, proposal_id=1)
    # Negative test: inside the 30-minute window only the challenger may inspect, so the
    # proposer's side (here the guardian) cannot choose when validators read the post.
    send("inspect_by_non_flagger_rejected", "inspect_proposal", [1], guardian, proposal_id=1)
    send("inspect_proposal", "inspect_proposal", [1], challenger, proposal_id=1)
    proposal = read("get_proposal", [1])
    print(f"  consensus verdict: status={proposal['status']} score={proposal['threat_score']}")
    if proposal["status"] == "ANALYZING":
        send("execute_circuit_breaker", "execute_circuit_breaker", [1], challenger, proposal_id=1)
        proposal = read("get_proposal", [1])
    record["dao_key"] = DAO_KEY
    record["final_proposal"] = proposal
    record["committed_proposal"] = read("get_committed_proposal", [DAO_KEY, 1])
    record["verdict"] = read("get_proposal_verdict", [DAO_KEY, 1])
    record["ledger"] = read("get_ledger", [])
    # An execution guard passes the hash of the proposal it is about to run. A frozen proposal
    # blocks only a payload whose hash equals the committed one.
    committed_hash = bytes.fromhex(record["committed_proposal"]["payload_hash"][2:])
    record["execution_frozen"] = read("is_execution_frozen", [DAO_KEY, 1, committed_hash])
    record["execution_frozen_for_a_different_payload"] = read("is_execution_frozen", [DAO_KEY, 1, bytes(32)])
    record["solvent"] = read("solvency", [])
    save()
    print(f"  final status: {proposal['status']}  frozen={record['execution_frozen']}")
    print(f"  telemetry saved to {DEPLOYMENT_FILE.relative_to(ROOT)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy ArgusGov and replay attack scenarios")
    parser.add_argument("--mode", choices=["direct", "network"], default="direct")
    parser.add_argument("--endpoint", default=STUDIO_NEXT_RPC)
    parser.add_argument("--forum-url", default="https://example.com",
                        help="page validators read as the declared intent")
    args = parser.parse_args()
    if args.mode == "direct":
        return run_direct()
    return run_network(args.endpoint, args.forum_url)


if __name__ == "__main__":
    sys.exit(main())
