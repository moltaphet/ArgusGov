#!/usr/bin/env python3
"""Live on-chain verification of the provenance and execution-gate methods on Studio Next.

Run after `deploy_and_simulate.py --mode network` (and `verify_live.py`). Reads the contract
address from deployments/studio-next.json and asserts, with real transactions and reads:

  a. get_execution_gate / is_execution_blocked agree with the settled verdict of proposal 1
  b. a commitment starts UNVERIFIED and get_provenance reports it
  c. attest_provenance with a tampered description hash reverts on-chain ("provenance mismatch")
  d. attest_provenance with the canonical description hash passes derivation and then stops at the
     origin-chain RPC step (Studio Next, chain 61997, has no trusted endpoint), so derivation is
     proven on-chain without any mocked RPC

Keys come from GUARDIAN_KEY / CHALLENGER_KEY (environment or the git-ignored .env.studio).
"""

import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORD = ROOT / "deployments" / "studio-next.json"
OUTPUT = ROOT / "deployments" / "live-verification-hardening.json"

spec = importlib.util.spec_from_file_location("deploy_and_simulate", ROOT / "scripts" / "deploy_and_simulate.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

GOVERNOR = "0x" + "c0" * 20
DESCRIPTION = b"# Marketing grant\nFund Q3 marketing."


def main() -> int:
    from eth_abi import encode
    from eth_account import Account
    from eth_utils import keccak
    from genlayer_py import create_client
    from genlayer_py.chains import studio_devnet

    record = json.loads(RECORD.read_text())
    address, dao_key = record["contract_address"], record["dao_key"]
    guardian = Account.from_key(deploy._load_keys()["GUARDIAN_KEY"])
    client = create_client(chain=studio_devnet, endpoint=record["rpc_url"], account=guardian)
    log = {"contract_address": address, "steps": [], "ran_at": datetime.now(timezone.utc).isoformat()}

    def read(fn, args):
        return client.read_contract(address=address, function_name=fn, args=args, account=guardian)

    def send(label, fn, args):
        fees = client.estimate_transaction_fees()
        tx = client.write_contract(address=address, function_name=fn, args=args, account=guardian, fees=fees)
        receipt = client.wait_for_transaction_receipt(transaction_hash=tx, wait_until="decided", retries=200,
                                                      interval=3000, full_transaction=True)
        execution = receipt.get("tx_execution_result_name") or receipt.get("txExecutionResultName")
        leader = ((receipt.get("consensus_data") or {}).get("leader_receipt") or [{}])[0]
        revert = (leader.get("result") or {}).get("payload") if execution != "FINISHED_WITH_RETURN" else None
        step = {"label": label, "tx_hash": tx, "execution": execution, "revert_message": revert,
                "explorer_url": f"{record['explorer_url']}/transactions/{tx}"}
        log["steps"].append(step)
        print(f"  {label}: {execution}" + (f"  [{revert}]" if revert else ""))
        return step

    def check(condition, message):
        if not condition:
            OUTPUT.write_text(json.dumps({**log, "passed": False, "failed_assertion": message}, indent=2, default=str) + "\n")
            sys.exit(f"ASSERTION FAILED: {message}")
        print(f"    ok: {message}")

    print(f"Hardening verification against {address}")
    # a. the execution gate for the settled proposal 1
    committed = read("get_committed_proposal", [dao_key, 1])
    h = bytes.fromhex(committed["payload_hash"][2:])
    gate = read("get_execution_gate", [dao_key, 1, h])
    check(gate["hash_matches"] and gate["frozen"] and gate["blocked"], "the settled malicious proposal is frozen and blocked")
    check(read("is_execution_blocked", [dao_key, 1, h]) is True, "is_execution_blocked agrees")
    check(read("get_execution_gate", [dao_key, 1, bytes(32)])["blocked"] is False, "the gate is bound to the committed hash")

    # b. a fresh commitment under the canonical Governor id
    targets, values = [deploy.TOKEN], [0]
    calldata = deploy.transfer_calldata(deploy.ATTACKER, 5_000 * deploy.ATTO)
    desc_hash = keccak(DESCRIPTION)
    pid = int.from_bytes(keccak(encode(["address[]", "uint256[]", "bytes[]", "bytes32"],
                                       [targets, values, [bytes.fromhex(calldata[2:])], desc_hash])), "big")
    step = send("b_commit_under_governor_id", "commit_proposal", [dao_key, pid, targets, values, [calldata], record["forum_url"]])
    check(step["execution"] == "FINISHED_WITH_RETURN", "the commitment under the canonical id was accepted")
    prov = read("get_provenance", [dao_key, pid])
    check(prov["status"] == "UNVERIFIED" and prov["verified"] is False, "a new commitment starts UNVERIFIED")

    # c. tampered description hash
    step = send("c_attest_tampered_description", "attest_provenance",
                [dao_key, pid, GOVERNOR, "0x" + keccak(DESCRIPTION + b" plus a hidden drain").hex()])
    check(step["execution"] == "FINISHED_WITH_ERROR" and "provenance mismatch" in (step["revert_message"] or ""),
          "a tampered description hash reverts with 'provenance mismatch'")

    # d. canonical hash: derivation passes, then the RPC step has no endpoint on chain 61997
    step = send("d_attest_canonical_hash", "attest_provenance", [dao_key, pid, GOVERNOR, "0x" + desc_hash.hex()])
    check(step["execution"] == "FINISHED_WITH_ERROR" and "no trusted RPC endpoint for chain 61997" in (step["revert_message"] or ""),
          "the canonical hash passes derivation and stops at the origin-chain RPC step")
    check(read("get_provenance", [dao_key, pid])["status"] == "UNVERIFIED", "a failed attestation changed nothing")
    check(read("solvency", []) is True, "the ledger is solvent")

    log.update({"passed": True})
    OUTPUT.write_text(json.dumps(log, indent=2, default=str) + "\n")
    print(f"\nAll hardening assertions passed. Report: {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
