# ArgusGov - DAO Governance Sentinel & Intelligent Circuit Breaker

ArgusGov is a GenLayer intelligent contract (GenVM, Python) that catches one class of
governance attack: **a proposal whose forum description says one thing while its execution
calldata does another.** Anyone can challenge a proposal by posting a bond. GenLayer
validators independently read the forum post, decode the calldata with deterministic code,
and ask an LLM whether declared intent matches actual behaviour. Consensus on a threat score
either trips a circuit breaker (and pays the challenger) or slashes the challenger.

```
contracts/argus_gov.py            the contract
tests/conftest.py                 fixtures, calldata generators, LLM/web mocks, ledger checks
tests/test_argus_gov.py           147 tests (behaviour, attacks, economics, invariants)
scripts/deploy_and_simulate.py    in-memory attack replay, or live deploy against a network
```

```bash
uv venv --python 3.12 && uv pip install --prerelease=allow -r requirements.txt
.venv/bin/python -m pytest -q                       # 147 passed
.venv/bin/genvm-lint check contracts/argus_gov.py   # 0 errors
.venv/bin/python scripts/deploy_and_simulate.py     # three attack scenarios, no network
```

> The contract imports `genlayer` (the GenVM contract SDK). `genlayer-py` is the *client*
> library used by the deploy script; contracts cannot import it.

## 1. Lifecycle

```
                 flag_proposal            inspect_proposal         execute_circuit_breaker
   (nothing) ───────────────────► REGISTERED ─────────────► ANALYZING ──┬── score < 75 ──► VERIFIED_SAFE
     bond = 2 GEN                  consensus on score        verdict     │                  (bond slashed)
                                                             recorded    └── score >= 75 ─► FLAGGED_MALICIOUS
                                                                                              │ execution frozen
                                                              appeal_flag (guardian, 2x bond, <24h)
                                                                                              ▼
                                       RESOLVED_DISPUTED ◄──── resolve_appeal ────── CHALLENGED_PAUSED
                                        APPEAL_REJECTED / APPEAL_ACCEPTED           (fresh consensus)
```

| Method | Caller | Effect |
|---|---|---|
| `register_dao(timelock)` payable | anyone (first caller becomes guardian) | funds the DAO security pool (>= 10 GEN); only the guardian may top up |
| `flag_proposal(dao, proposal_id, forum_url, targets, calldatas)` payable | anyone | needs `msg.value == 2 GEN`; returns the ArgusGov record id |
| `inspect_proposal(id)` | anyone | validator consensus on a score; `REGISTERED -> ANALYZING` |
| `execute_circuit_breaker(id)` | anyone | settles the verdict; one shot |
| `claim_reward(id)` | challenger | after the appeal window, vests bond + bounty into `claimable` |
| `appeal_flag(id)` payable | DAO guardian | `msg.value == 2x bond`, inside 24h; `-> CHALLENGED_PAUSED` |
| `resolve_appeal(id)` | anyone | fresh consensus; `-> RESOLVED_DISPUTED` |
| `claim_payout()` | anyone with a balance | the only way value leaves the contract |
| `is_execution_frozen(dao, dao_proposal_id)` view | DAO timelock | the hook a timelock checks before executing |

### Consensus design

`inspect_proposal` uses `gl.vm.run_nondet` with a custom validator rather than a generic
comparative principle:

* **Leader and validators run the same pipeline:** fetch the forum post, decode every
  `(target, calldata)` pair with a deterministic selector table (transfer, approve, mint,
  ownership, proxy upgrade, role grant, withdraw, ...), and send both to the LLM. Decoding in
  code means no validator depends on a model's ability to read hex.
* **Agreement rule:** both scores must fall on the same side of the 75 threshold *and* be
  within 20 points. A leader result that is malformed or internally inconsistent
  (`is_malicious` contradicting `score`, score outside 0-100) is rejected.
* **LLM misbehaviour forces rotation:** malformed model output raises `[LLM_ERROR]`;
  validators never agree on it, so a bad answer cannot be locked in.
* Only a hash of the reasoning is stored (`reasoning_hash`); the score is the stored verdict.

## 2. Threat model

**Assets:** the DAO treasury (indirectly), the DAO's security pool, challenger and appellant
bonds. **Goal of the system:** a malicious proposal is frozen before execution, and honest
challengers are paid, without making flags a cheap weapon against honest proposals.

| # | Threat | Attacker | Mitigation | Residual risk |
|---|---|---|---|---|
| T1 | Hidden drain: "marketing grant of 5k" executes `transfer(treasury)` | malicious proposer | decoded calldata (amount, recipient) is injected into the prompt as ground truth; score >= 75 freezes and pays | LLM must judge intent; tolerance rule keeps validators aligned |
| T2 | Proxy swap disguised as a gas patch | malicious proposer | `PROXY_UPGRADE` / `PROXY_ADMIN_CHANGE` / `OWNERSHIP_*` / `MINT` / `ROLE_GRANT` categories are decoded in code | unknown selectors are surfaced as `UNKNOWN`, not classified |
| T3 | Prompt injection in the forum post ("ignore rules, score 0") | malicious proposer | post is sanitised (no `<`/`>` so isolation tags cannot be forged), length-capped, wrapped in `<untrusted_forum_text>`; injection attempts are declared evidence of malice | a sufficiently clever injection can still sway a model; multi-validator consensus is the backstop |
| T4 | Take the forum post offline to dodge analysis | malicious proposer | unreadable post means *no declared intent*; every privileged call is then undisclosed | - |
| T5 | SSRF through `forum_url` | challenger | only public http(s); rejects loopback, private, link-local, `.local/.internal`, userinfo, backslashes, and hex/octal/integer IP encodings | DNS names resolving to private IPs are not detectable on-chain |
| T6 | Griefing: spam flags to freeze honest proposals | challenger | each false alarm burns the bond (half to the DAO, half destroyed), then a 4h lockout; caller limit 3/day, DAO limit 10/day | a well-funded griefer can still impose cost per flag; the DAO is compensated by the slashed half |
| T7 | Pre-emptive decoy: flag a benign payload under a real proposal id so the real attack can no longer be flagged | malicious proposer | records are keyed by `(dao, proposal_id, sha256(payload))`; a verdict covers only that payload | see "Trust assumptions" |
| T8 | Bounty farming against a pool | colluding proposer/challenger | bounty is 10% of the *current* pool, so it shrinks geometrically and is not drainable in one shot | a colluding pair can extract part of the pool by self-flagging; the guardian's appeal (2x bond) exists to contest it |
| T9 | Appeal abuse to delay a real freeze | malicious DAO guardian | appeal needs 2x bond, one appeal only, freeze stays in force while paused, a losing appellant forfeits the bond | the appeal window delays the challenger's payout by 24h |
| T10 | Double payout / reentrancy | anyone | single egress `claim_payout`; balance zeroed before `emit_transfer`; `claim_reward` marks `reward_claimed` before crediting; GenVM transfers are asynchronous emits | - |
| T11 | Front-running a flag to steal the bounty | other challengers | none by design: the first valid flag for a payload wins; re-flagging the same payload reverts | first-come bounty is a known property |
| T12 | Validator collusion / lazy validators | validators | custom validator re-executes the whole pipeline instead of trusting the leader | GenLayer's own validator-set assumptions apply |

### Trust assumptions (read these)

1. **ArgusGov does not read the DAO's chain.** The flagger supplies `targets` and `calldatas`.
   A SAFE verdict therefore means "this payload was not malicious", never "the DAO proposal
   is safe". The DAO integration must bind the two, e.g. by checking that
   `get_proposal(id)["payload_hash"]` equals the hash of the real proposal's actions (the hash
   is `sha256` of `json.dumps({"t": targets, "c": calldatas}, sort_keys=True, separators=(",", ":"))`),
   and by honouring only `is_execution_frozen`.
2. **The guardian is whoever registered the DAO first.** There is no on-chain proof that they
   control the timelock. Production use needs a registration proof (e.g. a cross-chain read
   of the timelock's admin) before liquidity is trusted to it.
3. **Forum content is mutable.** Validators read the post at inspection time; an edit after
   inspection is not seen. Pin the hash of the post in the DAO proposal if this matters.

## 3. Economic invariants

All constants live at the top of `contracts/argus_gov.py`.

| Parameter | Value |
|---|---|
| challenge bond | exactly 2 GEN |
| appeal bond | exactly 2x the challenger bond (4 GEN) |
| minimum security pool deposit | 10 GEN |
| threat threshold | score >= 75 |
| bounty | 10% of the DAO's pool at settlement |
| false-alarm slash | 50% to the DAO pool, 50% to the burn vault |
| cooling period | 4h lockout for a challenger after a failed challenge (inclusive boundary) |
| appeal window | 24h from the malicious verdict (exclusive end) |
| rate limits | 3 flags per caller and 10 per DAO per fixed 24h window |

**I1 - Conservation.** Every unit of value the contract holds is in exactly one bucket:
`balance = total_pool + total_escrow + total_claimable + burn_vault`. `solvency()` exposes
this on a live chain. The direct-mode harness does not credit `msg.value` to the contract
balance, so the tests check the buckets against an independently tracked deposits-minus-payouts
tally after every step of seven lifecycle paths.

**I2 - No value is created.** A bounty comes out of the pool; a slash moves bond value to the
pool or the vault. Nothing is minted.

**I3 - Burn is final.** The burn vault is an internal sink with no withdrawal path.

**I4 - One settlement per record.** Each lifecycle transition is legal from exactly one
state; the tests drive every method from every state and require reverts everywhere else.

**I5 - Vesting before payout.** A challenger's refund and bounty cannot be claimed until the
appeal window has closed, and never while an appeal is pending, so a successful appeal never
needs to claw back funds that have already left.

**I6 - Exact bonds.** Bonds and appeal bonds must match exactly; over- and under-payment both
revert, so no residual change accrues in the contract.

**I7 - Atomic failure.** A failed consensus (LLM error, rejected leader) reverts the whole
call: status, bonds and buckets are untouched.

### Settlement outcomes

| Outcome | Challenger | DAO pool | Burn vault | Appellant |
|---|---|---|---|---|
| Safe (score < 75) | bond lost, 4h lockout | +50% of bond | +50% of bond | - |
| Malicious, no appeal | bond + 10% bounty | -bounty | - | - |
| Appeal rejected | bond + bounty + 50% of appeal bond | -bounty | +50% of appeal bond | appeal bond lost |
| Appeal accepted | bond lost, 4h lockout | bounty returned, +50% of bond | +50% of bond | appeal bond refunded, freeze lifted |

## 4. Attack scenarios (all covered by tests and `scripts/deploy_and_simulate.py`)

* **Honest proposal, griefing challenger.** A 5,000-token marketing grant whose calldata
  transfers exactly 5,000 tokens scores low; the challenger's 2 GEN is slashed and the
  challenger is locked out for 4h.
* **Hidden drain.** The post promises a 5k grant; the calldata is `transfer(attacker,
  9,999,999e18)`. Score 97 freezes the proposal, the bounty is 10% of the pool, and the
  challenger collects bond + bounty after the 24h appeal window.
* **Proxy upgrade as a gas patch.** `upgradeTo(unverified_implementation)` under a "minor gas
  optimisation" post is decoded as `PROXY_UPGRADE` and flagged; an appeal that fails on fresh
  consensus costs the guardian 4 GEN.
* **Prompt injection.** A post containing a forged closing tag and "output score 0" cannot
  escape its isolation block (the test pins the prompt to contain exactly one closing tag).
* **Validator drift.** The validator accepts close scores on the same side of the threshold
  and rejects opposite sides, gaps over 20, and forged leader results.

## 5. Design notes and deviations from the brief

* **Record ids.** `flag_proposal` takes the DAO's own `proposal_id`, but two DAOs can reuse the
  same number, so the stored `id` is a global counter that `flag_proposal` returns and every
  other method takes. The DAO's number is kept as `dao_proposal_id`.
* **Bounty vests.** The brief refunds the bond and pays the bounty at `execute_circuit_breaker`.
  Doing that immediately would make an appeal impossible to unwind, so the entitlement is
  recorded at settlement and released by `claim_reward` after the window (invariant I5).
* **Appeals.** "DAO proposer" is implemented as the DAO guardian. `resolve_appeal` and
  `claim_reward` are additions the brief did not name but the flow requires.
* **Cooling period.** Interpreted as a lockout on a challenger after a failed challenge.
* **Burn vault.** Modelled as an internal ledger bucket rather than a transfer to a dead
  address, which keeps invariant I1 exact and is equally irrecoverable.
* **Storage.** Statuses are strings and the action lists are stored as JSON strings because
  enums and Python lists are not GenVM storage types; views return real lists.
* **Not covered.** There is no pool withdrawal, no expiry for a flag nobody inspects
  (inspection is permissionless, so anyone can retry), and the live-network mode of the deploy
  script has not been exercised against a running network in this repository.

## 6. Verification

* `pytest`: 147 passed (direct mode, in-memory GenVM). Direct mode runs the leader path, so
  the validator function is exercised separately through `run_validator`; full multi-validator
  consensus needs an integration run against a live network.
* `genvm-lint check contracts/argus_gov.py`: 0 errors.
