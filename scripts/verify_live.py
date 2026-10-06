#!/usr/bin/env python3
"""Live on-chain verification of the ArgusGov transaction flow on Studio Next.

Run after `deploy_and_simulate.py --mode network`; it reads the contract address from
deployments/studio-next.json and exercises the commitment and inspection-window rules with
real transactions, asserting each outcome. It exits non-zero on the first failed assertion.

  a. commit a proposal                                   (guardian)
  b. flag it                                             (Challenger A)
  c. inspect from a non-challenger inside the 30-minute window -> must revert on-chain
  d. inspect from Challenger A                           -> must succeed
  e. read get_proposal_verdict and check the state transition (and settle it)

Keys come from GUARDIAN_KEY / CHALLENGER_KEY (environment or the git-ignored .env.studio).
"""

import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORD = ROOT / "deployments" / "studio-next.json"
OUTPUT = ROOT / "deployments" / "live-verification.json"

spec = importlib.util.spec_from_file_location("deploy_and_simulate", ROOT / "scripts" / "deploy_and_simulate.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

PROPOSAL_ID = 2  # the deploy scenario already used proposal 1
WINDOW = 30 * 60
THRESHOLD = 75


def main() -> int:
    from eth_account import Account
    from genlayer_py import create_client
    from genlayer_py.chains import studio_devnet

    record = json.loads(RECORD.read_text())
    address = record["contract_address"]
    dao_key = record["dao_key"]
    keys = deploy._load_keys()
    guardian = Account.from_key(keys["GUARDIAN_KEY"])       # also the non-challenger in step c
    challenger = Account.from_key(keys["CHALLENGER_KEY"])   # Challenger Account A
    client = create_client(chain=studio_devnet, endpoint=record["rpc_url"], account=guardian)

    log = {"contract_address": address, "dao_key": dao_key, "proposal_id": PROPOSAL_ID, "steps": [],
           "ran_at": datetime.now(timezone.utc).isoformat()}

    def read(fn, args):
        return client.read_contract(address=address, function_name=fn, args=args, account=guardian)

    def send(label, fn, args, who, value=0):
        fees = client.estimate_transaction_fees()
        tx = client.write_contract(address=address, function_name=fn, args=args, account=who, value=value, fees=fees)
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

    print(f"Live verification against {address} (proposal {PROPOSAL_ID})")
    calldata = deploy.transfer_calldata(deploy.ATTACKER, 9_999_999 * deploy.ATTO)

    # a. commit
    step = send("a_commit_proposal", "commit_proposal",
                [dao_key, PROPOSAL_ID, [deploy.TOKEN], [0], [calldata], record["forum_url"]], guardian)
    check(step["execution"] == "FINISHED_WITH_RETURN", "the guardian's commitment was accepted")
    committed = read("get_committed_proposal", [dao_key, PROPOSAL_ID])
    check(committed["flaggable"] is True and committed["flag_id"] == 0, "the proposal is committed and open for challenge")

    # b. flag from Challenger A
    step = send("b_flag_proposal", "flag_proposal", [dao_key, PROPOSAL_ID], challenger, deploy.BOND)
    check(step["execution"] == "FINISHED_WITH_RETURN", "Challenger A's flag was accepted")
    committed = read("get_committed_proposal", [dao_key, PROPOSAL_ID])
    record_id = int(committed["flag_id"])
    flag = read("get_proposal", [record_id])
    check(flag["status"] == "REGISTERED" and flag["challenger"] == challenger.address.lower(), "the flag is REGISTERED to Challenger A")
    check(flag["inspection_opens_at"] - flag["proposed_at"] == WINDOW, "the exclusive window is exactly 30 minutes")
    before = read("get_proposal_verdict", [dao_key, PROPOSAL_ID])
    check(before["flagged"] and before["status"] == "REGISTERED" and before["reasoning"] == "", "no verdict exists yet")

    # c. non-challenger inside the window must revert
    step = send("c_inspect_by_non_challenger", "inspect_proposal", [record_id], guardian)
    check(step["execution"] == "FINISHED_WITH_ERROR", "the non-challenger's inspection reverted")
    check("inspection is reserved for the challenger" in (step["revert_message"] or ""), "it reverted for the right reason")
    unchanged = read("get_proposal_verdict", [dao_key, PROPOSAL_ID])
    check(unchanged["status"] == "REGISTERED" and unchanged["reasoning"] == "", "the rejected attempt changed nothing")

    # d. Challenger A inspects
    step = send("d_inspect_by_challenger", "inspect_proposal", [record_id], challenger)
    check(step["execution"] == "FINISHED_WITH_RETURN", "Challenger A's inspection succeeded through validator consensus")

    # e. verdict and state transition
    verdict = read("get_proposal_verdict", [dao_key, PROPOSAL_ID])
    check(verdict["status"] == "ANALYZING", "status moved REGISTERED -> ANALYZING")
    check(0 <= verdict["threat_score"] <= 100 and len(verdict["reasoning"]) > 0, "a score and reasoning text were recorded")
    check(len(verdict["reasoning"]) <= 1000, "the reasoning respects the 1,000-character cap")
    import hashlib
    check(hashlib.sha256(verdict["reasoning"].encode()).hexdigest() == verdict["reasoning_hash"], "the reasoning matches its on-chain hash")
    check(verdict["payload_hash"] == committed["payload_hash"], "the verdict is bound to the committed payload hash")

    step = send("e_execute_circuit_breaker", "execute_circuit_breaker", [record_id], challenger)
    check(step["execution"] == "FINISHED_WITH_RETURN", "the verdict was settled")
    final = read("get_proposal_verdict", [dao_key, PROPOSAL_ID])
    expected = "FLAGGED_MALICIOUS" if verdict["threat_score"] >= THRESHOLD else "VERIFIED_SAFE"
    check(final["status"] == expected, f"score {verdict['threat_score']} settled as {expected}")
    committed_hash = bytes.fromhex(committed["payload_hash"][2:])
    frozen = read("is_execution_frozen", [dao_key, PROPOSAL_ID, committed_hash])
    check(frozen is (expected == "FLAGGED_MALICIOUS"), "the hash-bound freeze matches the verdict")
    check(read("is_execution_frozen", [dao_key, PROPOSAL_ID, bytes(32)]) is False, "a different payload hash is never frozen")
    check(read("solvency", []) is True, "the ledger is solvent")

    log.update({"passed": True, "final_status": final["status"], "threat_score": final["threat_score"],
                "reasoning_chars": len(final["reasoning"])})
    OUTPUT.write_text(json.dumps(log, indent=2, default=str) + "\n")
    print(f"\nAll live assertions passed. Report: {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
