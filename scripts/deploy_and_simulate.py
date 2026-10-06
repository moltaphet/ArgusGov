#!/usr/bin/env python3
"""Deploy ArgusGov and replay real attack shapes against it.

Two modes:

  direct   (default) In-memory GenVM. Deterministic validators are mocked, so it
           needs no network and finishes in seconds. It replays three scenarios
           (safe proposal, hidden treasury drain, malicious proxy upgrade with a
           failed appeal) and prints the resulting ledger.

  network  Deploys to a live GenLayer endpoint (localnet / studionet) with
           genlayer-py and runs the hidden-drain scenario through REAL validator
           consensus. Needs two funded keys and a forum page you control whose
           text describes a small marketing grant:

             GUARDIAN_KEY=0x.. CHALLENGER_KEY=0x.. \\
               python scripts/deploy_and_simulate.py --mode network \\
               --endpoint http://127.0.0.1:4000/api --forum-url https://example.org/post

Usage:
    python scripts/deploy_and_simulate.py              # direct mode
    python scripts/deploy_and_simulate.py --mode network --forum-url URL
"""

import argparse
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
        argus.register_dao(TIMELOCK)
        ledger(argus)

        # --- Scenario 1: honest proposal, griefing challenger -----------------
        banner("SCENARIO 1  Honest proposal. A griefer flags it anyway.")
        call(challenger, BOND)
        rid = argus.flag_proposal(TIMELOCK, 101, "https://forum.dao.example/t/101", [TOKEN],
                                  [transfer_calldata("0x" + "a1" * 20, 5_000 * ATTO)])
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
        call(challenger, BOND)
        rid = argus.flag_proposal(TIMELOCK, 102, "https://forum.dao.example/t/102", [TOKEN],
                                  [transfer_calldata(ATTACKER, 9_999_999 * ATTO)])
        validators(97, "Marketing grant of 5k tokens for the Q3 campaign.",
                   "Post declares a 5k grant; calldata moves 9,999,999 tokens to an unknown address.")
        call(keeper)
        score = argus.inspect_proposal(rid)
        status = argus.execute_circuit_breaker(rid)
        print(f"  consensus score={score} -> {status}")
        print(f"  execution frozen for DAO proposal 102: {argus.is_execution_frozen(TIMELOCK, 102)}")
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
        call(challenger, BOND)
        rid = argus.flag_proposal(TIMELOCK, 103, "https://forum.dao.example/t/103", [PROXY],
                                  [upgrade_calldata(ATTACKER)])
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
def run_network(endpoint: str, forum_url: str) -> int:
    from eth_account import Account
    from genlayer_py import create_client
    from genlayer_py.chains import localnet

    for var in ("GUARDIAN_KEY", "CHALLENGER_KEY"):
        if not os.environ.get(var):
            sys.exit(f"{var} is required in network mode (a funded private key)")
    guardian = Account.from_key(os.environ["GUARDIAN_KEY"])
    challenger = Account.from_key(os.environ["CHALLENGER_KEY"])
    client = create_client(chain=localnet, endpoint=endpoint, account=guardian)

    def send(address, fn, args, who, value=0):
        tx = client.write_contract(address=address, function_name=fn, args=args,
                                   account=who, value=value)
        receipt = client.wait_for_transaction_receipt(transaction_hash=tx)
        print(f"  {fn}: tx {tx[:12]}... status={getattr(receipt, 'status_name', receipt)}")
        return receipt

    print("Deploying ArgusGov...")
    tx = client.deploy_contract(code=CONTRACT.read_bytes(), account=guardian, args=[])
    receipt = client.wait_for_transaction_receipt(transaction_hash=tx)
    address = (receipt.get("data") or {}).get("contract_address")
    if not address:
        sys.exit(f"deployment did not return a contract address: {receipt}")
    print(f"  deployed at {address}")

    send(address, "register_dao", [TIMELOCK], guardian, POOL)
    send(address, "flag_proposal",
         [TIMELOCK, 1, forum_url, [TOKEN], [transfer_calldata(ATTACKER, 9_999_999 * ATTO)]],
         challenger, BOND)
    send(address, "inspect_proposal", [1], challenger)
    send(address, "execute_circuit_breaker", [1], challenger)
    print(json.dumps(client.read_contract(address=address, function_name="get_proposal",
                                          args=[1]), indent=2, default=str))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy ArgusGov and replay attack scenarios")
    parser.add_argument("--mode", choices=["direct", "network"], default="direct")
    parser.add_argument("--endpoint", default="http://127.0.0.1:4000/api")
    parser.add_argument("--forum-url", help="forum page describing a small marketing grant")
    args = parser.parse_args()
    if args.mode == "direct":
        return run_direct()
    if not args.forum_url:
        sys.exit("--forum-url is required in network mode")
    return run_network(args.endpoint, args.forum_url)


if __name__ == "__main__":
    sys.exit(main())
