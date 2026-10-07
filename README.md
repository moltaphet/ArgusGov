# ArgusGov - DAO Governance Sentinel & Intelligent Circuit Breaker

ArgusGov is a GenLayer intelligent contract (GenVM, Python) that catches one class of
governance attack: **a proposal whose forum description says one thing while its execution
calldata does another.** A DAO commits the payload each proposal will execute. Anyone can then
challenge a committed proposal by posting a bond. GenLayer validators independently read the
forum post, decode the calldata and native values with deterministic code, and ask an LLM
whether declared intent matches actual behaviour. Consensus on a threat score either trips a
circuit breaker (and pays the challenger) or slashes the challenger.

```
contracts/argus_gov.py            the contract
contracts/enforcement/            ArgusGuardedTimelock.sol reference adapter, ArgusGovMirror.sol, Python model, forge tests
tests/conftest.py                 fixtures, calldata generators, LLM/web mocks, ledger checks
tests/test_argus_gov.py           core suite: behaviour, attacks, economics, invariants, regressions
tests/test_provenance_enforcement.py  provenance derivation/tamper/orphan checks and end-to-end enforcement
tests/                            341 tests (behaviour, attacks, economics, invariants, provenance, enforcement)
scripts/deploy_and_simulate.py    in-memory attack replay, or live deploy against a network
frontend/                         Next.js dashboard (305 tests)
deployments/                      live Studio Next records (v1 archived, current)
```

```bash
uv venv --python 3.12 && uv pip install --prerelease=allow -r requirements.txt
.venv/bin/python -m pytest -q                       # 341 passed
.venv/bin/genvm-lint check contracts/argus_gov.py   # 0 errors
.venv/bin/python scripts/deploy_and_simulate.py     # three attack scenarios, no network
```

> The contract imports `genlayer` (the GenVM contract SDK). `genlayer-py` is the *client*
> library used by the deploy script; contracts cannot import it.

## 1. Lifecycle

A DAO is identified by `dao_key = "<chain_id>:<0xtimelock>"`, so the same address on two chains
is two DAOs.

```
 guardian / timelock          challenger                 anyone                    anyone
 commit_proposal  ───────►  flag_proposal(dao_key, id) ─► inspect_proposal ───────► execute_circuit_breaker
 payload + forum URL        bond = 2 GEN                 consensus on score         │
 (write-once)               REGISTERED ─ 7 days idle ─► EXPIRED (bond returned)     ├─ score < 75 ──► VERIFIED_SAFE (bond slashed)
                                                         ANALYZING                  └─ score >= 75 ─► FLAGGED_MALICIOUS, frozen
                                                                                                          │ appeal_flag (guardian, 2x bond, <24h)
                                                                                                          ▼
        unfreeze_proposal ◄─ APPEAL_ACCEPTED ── RESOLVED_DISPUTED ◄── resolve_appeal ── CHALLENGED_PAUSED
                                                  APPEAL_REJECTED = freeze is permanent   (fresh consensus)

 VERIFIED_SAFE ── flag_proposal again (once, bond = 2x) ──► a new REGISTERED record; a second SAFE verdict is final
```

| Method | Caller | Effect |
|---|---|---|
| `register_dao(dao_key)` payable | anyone (first caller becomes guardian) | funds the DAO security pool (>= 10 GEN); only the guardian may top up |
| `claim_guardianship(dao_key)` | the timelock address | takes the guardian role from whoever registered first |
| `commit_proposal(dao_key, proposal_id, targets, values, calldatas, forum_url)` | guardian or timelock | records the payload once and returns its `keccak256(abi.encode(...))` commitment |
| `flag_proposal(dao_key, proposal_id)` payable | anyone | `msg.value == 2 GEN` (or **4 GEN** for the one re-flag of a proposal judged safe); payload comes only from the commitment; returns the record id |
| `expire_flag(id)` | anyone | after 7 days, returns the bond of a flag nobody inspected and frees the proposal |
| `inspect_proposal(id)` | the challenger for 30 min after the flag, then anyone | validator consensus on a score; `REGISTERED -> ANALYZING` |
| `execute_circuit_breaker(id)` | anyone | settles the verdict; one shot |
| `claim_reward(id)` | challenger | after the appeal window, vests bond + bounty into `claimable` |
| `appeal_flag(id)` payable | DAO guardian | `msg.value == 2x bond`, inside 24h; `-> CHALLENGED_PAUSED` |
| `resolve_appeal(id)` | anyone | fresh consensus; `-> RESOLVED_DISPUTED` |
| `unfreeze_proposal(dao_key, proposal_id)` | anyone | lifts the freeze once an appeal was accepted; refuses while a malicious verdict stands |
| `withdraw_pool(dao_key, amount)` | guardian | withdraws idle pool funds; bounties reserved for open flags stay locked |
| `claim_payout()` | anyone with a balance | the only way value leaves the contract |
| `is_execution_frozen(dao_key, proposal_id, expected_payload_hash)` view | a DAO's execution guard | true only if the proposal is committed, frozen, **and** `expected_payload_hash` equals the committed hash byte for byte |
| `attest_provenance(dao_key, proposal_id, governor, description_hash)` | anyone | proves the proposal came from a real Governor: canonical id derivation, then validator consensus over origin-chain RPC; sets `VERIFIED` or `ORPHAN` |
| `get_execution_gate(dao_key, proposal_id, expected_payload_hash)` / `is_execution_blocked(...)` view | a DAO's execution guard | `blocked` is true while a verdict freezes the proposal **or** a dispute is still being inspected |
| `get_provenance(dao_key, proposal_id)` view | anyone | origin chain, Governor, `description_hash` and the binding hash |
| `get_proposal_verdict(dao_key, proposal_id)` view | anyone | score, `is_malicious` and the **full reasoning text** |
| `get_committed_*`, `get_dao_*` views | anyone | enumerate commitments and registered DAOs; a commitment reports `flaggable`, `required_bond`, `reflag_count` and `flag_status` |

### Consensus design

`inspect_proposal` uses `gl.vm.run_nondet` with a custom validator rather than a generic
comparative principle:

* **Leader and validators run the same pipeline:** fetch the forum post, decode every
  `(target, native value, calldata)` action with a deterministic selector table (transfer,
  approve, mint, ownership, proxy upgrade, role grant, withdraw, plain native sends, ...), and
  send both to the LLM. Decoding in code means no validator depends on a model's ability to read hex.
* **Agreement rule:** both scores must fall on the same side of the 75 threshold *and* be
  within 20 points. A leader result that is malformed or internally inconsistent
  (`is_malicious` contradicting `score`, score outside 0-100) is rejected.
* **LLM misbehaviour forces rotation:** malformed model output raises `[LLM_ERROR]`;
  validators never agree on it, so a bad answer cannot be locked in.
* The score and the reasoning text are stored; `reasoning_hash` is the SHA-256 of that stored
  text, so anyone can check a displayed reasoning against the chain. Reasoning is untrusted
  validator output, so it is bounded and sanitised before it is written (see invariant I10), and
  a validator rejects a leader whose reasoning is oversized or not valid UTF-8.

### The commitment

`payload_hash = keccak256(abi.encode(address[] targets, uint256[] values, bytes[] calldatas,
bytes32 keccak256(forum_url)))`, the layout Governor contracts hash proposals with. A DAO can
recompute it off-chain (the dashboard does, with viem) and compare it with
`get_committed_proposal(...).payload_hash`. `hashlib` only ships NIST SHA-3, which pads
differently from Ethereum's keccak, so the contract carries a small pure-Python keccak256. It is
checked against `eth_utils` across every padding boundary, against an independent `eth_abi`
encoding for varied payload shapes, and **on-chain**: the hash Studio Next stored for the demo
proposal equals the independent computation byte for byte.

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
| T5 | SSRF through `forum_url` (contract) and through the dashboard's forum reader | anyone | contract: public http(s) only, canonical dotted-decimal IPs only (octal, hex, integer and short forms refused), every failure a clean `[EXPECTED]` revert. Reader: every resolved address checked, the validated IP pinned for the connection, redirects re-validated, 10 requests/min/client | DNS names resolving to private IPs cannot be seen on-chain; the reader's limiter is per server instance |
| T6 | Griefing: spam flags to freeze honest proposals | challenger | each false alarm burns the bond (half to the DAO, half destroyed), then a 4h lockout; caller limit 3/day, DAO limit 10/day; a flag freezes nothing until a verdict says so | a well-funded griefer can still impose cost per flag; the DAO is compensated by the slashed half |
| T7 | **Forged payload: flag a real proposal id with fabricated malicious calldata and freeze it** | any challenger | flag takes `(dao_key, proposal_id)` only. The payload is whatever the DAO committed; only the guardian or timelock can commit, and only once | see trust assumption 1 |
| T17 | **Squat-and-freeze DoS:** a squatter holds a DAO's guardian seat, commits a forged payload and freezes it, hoping to block the real execution | squatter | the freeze check is bound to a hash: `is_execution_frozen(dao_key, id, expected_payload_hash)` is true only when the caller's hash equals the committed one byte for byte, so a guard that passes the genuine proposal's hash is never blocked by a forgery | the genuine DAO cannot commit, and so cannot have flagged, a proposal id a squatter committed first; this matters for sequential ids, not for hash-derived ones |
| T18 | **Inspect-timing manipulation:** validators read the forum post at the moment of inspection, so whoever picks that moment can steer what they read. A proposer edits the post to look harmless, then self-triggers `inspect_proposal` (at no bond cost, if someone else flagged) to collect a SAFE verdict and restores the misleading text afterwards | malicious proposer | **challenger-exclusive inspection window:** for the first 30 minutes after a flag, only the address that posted the bond may call `inspect_proposal` (`inspection_opens_at` is published in the view). The challenger can inspect immediately, so the post is read when they choose, and a proposer's rushed edit-then-inspect reverts. After 30 minutes inspection is permissionless, so a flagger who never inspects cannot lock the proposal. Also: a SAFE verdict can be re-flagged once at 2x the bond, which re-reads the post and opens its own exclusive window for the new flagger; a second SAFE verdict is final | **Narrowed, not eliminated.** The proposer can still edit the post *before* a flag lands, edit during the window and hope the challenger inspects after, inspect at minute 31 if the challenger is slow, or flag their own proposal (paying a bond that is slashed on SAFE) to gain the exclusive window. A colluding flagger defeats it. `resolve_appeal` stays permissionless. Pre-flag edits are closed fully only by content-addressed discussions (see the roadmap note in trust assumption 4). See trust assumption 4 |
| T19 | Oversized or malformed reasoning text bloats storage or breaks encoding | a hostile leader validator | reasoning is capped at 1,000 characters (truncated with `... [TRUNCATED]`), sanitised to valid UTF-8, bounded again before storage, and a validator rejects an oversized or unencodable leader result | - |
| T8 | Bounty farming against a pool | colluding proposer/challenger | bounty is 10% of the *unlocked* pool, so it shrinks geometrically and is not drainable in one shot | a colluding pair can extract part of the pool by self-flagging; the guardian's appeal (2x bond) exists to contest it |
| T9 | Appeal abuse to delay a real freeze | malicious DAO guardian | appeal needs 2x bond, one appeal only, freeze stays in force while paused, a losing appellant forfeits the bond | the appeal window delays the challenger's payout by 24h |
| T10 | Double payout / reentrancy | anyone | single egress `claim_payout`; balance zeroed before `emit_transfer`; `claim_reward` marks `reward_claimed` before crediting; GenVM transfers are asynchronous emits | - |
| T11 | Front-running a flag to steal the bounty | other challengers | none by design: the first valid flag for a committed proposal wins; re-flagging reverts | first-come bounty is a known property |
| T12 | Validator collusion / lazy validators | validators | custom validator re-executes the whole pipeline instead of trusting the leader | GenLayer's own validator-set assumptions apply |
| T13 | Guardian squatting: register someone else's timelock first | anyone | `claim_guardianship` lets the timelock take the seat from any squatter; the squatter then cannot commit, withdraw or appeal | only works when the timelock is itself an account on GenLayer; see trust assumption 2 |
| T14 | Native-currency drain (`value` on an empty call) hidden behind a benign post | malicious proposer | `values[]` are committed, decoded, totalled and put in the prompt next to the token amounts | native currency is assumed to have 18 decimals |
| T15 | Rug the challenger: withdraw the pool after a flag so the bounty is worth nothing | malicious guardian | the bounty is reserved at flag time and locked; `withdraw_pool` can only take unlocked funds | - |
| T16 | Abandoned flag locks a bond forever | nobody inspects | `expire_flag` returns the bond after 7 days (only for an uninspected flag, so a recorded verdict can never be escaped by waiting) | - |

### Trust assumptions (read these)

1. **The guardian is the root of trust for what a proposal does.** ArgusGov does not read the
   DAO's chain, so it believes what the guardian or timelock commits. A SAFE verdict therefore
   means "the committed payload was not malicious", never "the DAO proposal is safe".
   A squatter can register a DAO key they do not control and commit anything under it. That
   affects only that `dao_key`, and it **cannot block genuine execution**, because the freeze
   check is bound to a payload hash (assumption 2).
2. **Foreign-chain timelocks cannot act natively on GenLayer, so consumers must pass the hash.**
   `claim_guardianship` and direct timelock commits compare `msg.sender` with the timelock
   address. A contract on another chain (an EVM timelock, say) cannot be `msg.sender` here, so
   ArgusGov has no on-chain proof of who owns it, and until a cross-chain proof exists the
   seat can be held by whoever registered first. The protection is therefore on the consuming
   side. **An off-chain consumer guard (a relayer, keeper or oracle that gates execution on the
   origin chain) must compute the payload hash of the proposal it is about to execute and pass it
   as `expected_payload_hash`.** The call answers true only for a frozen, committed proposal whose
   hash matches byte for byte, so a forged commitment under the same id returns false and
   genuine execution proceeds. A guard that calls it with a hash read back from ArgusGov itself
   defeats the check and is unsafe. It should also verify that the guardian is who it expects.
3. **Commitments are write-once.** A typo in a committed payload cannot be fixed; the DAO
   commits again under a new proposal id. A squatter can pre-commit a *sequential* proposal id
   (Compound-style) before the real DAO does; hash-derived ids (OpenZeppelin Governor) cannot be
   guessed in advance.
4. **Forum content is mutable, and the commitment does not freeze it.** The payload is
   immutable; the forum post is not. The contract commits the forum *URL* and the payload, but
   validators read whatever the post says at inspection time, and an edit made afterwards is not
   seen. That opens a bait-and-switch: a proposer can make a post read benignly while a flag is
   inspected, collect a SAFE verdict, then restore a misleading description for voters. Three
   things limit it, none of which removes it:
   * a proposal judged safe can be **re-flagged once, at double the bond** (4 GEN), which makes
     validators read the post again as it stands then. The doubled bond prices out spam while
     leaving a genuine second challenge affordable, and the doubled stake is also doubled
     downside for a challenger who is wrong;
   * for the first 30 minutes after a flag **only the challenger can inspect** (T18), so a proposer cannot
     choose the moment validators read the post. This narrows the manipulation; it does not close it;
   * the second SAFE verdict is final, so the escalation is bounded and a proposer cannot be
     harassed indefinitely;
   * an unreadable post is treated as *no declared intent*, so taking it down is not an escape.

   The re-flag raises the price of the trick; it does not prove the post is stable. DAOs that
   care should reference a content-addressed post (an IPFS or Arweave link, or a hash pinned in
   the proposal description) so that "what the post said" cannot change under a fixed URL.

   **Content-Addressed Discussions (Future Roadmap):** For complete trustlessness against pre-flag forum edits, proposal discussion threads should ideally be content-addressed (e.g., hosted on IPFS or Arweave) or have their initial content hash committed alongside the proposal payload on-chain. Today the contract commits only the forum *URL* and the payload, so an edit made before a flag lands is not detectable on-chain; committing a content hash would close that gap.

## 3. Economic invariants

All constants live at the top of `contracts/argus_gov.py`.

| Parameter | Value |
|---|---|
| challenge bond | exactly 2 GEN; exactly 4 GEN (2x) for the one re-flag of a proposal judged safe |
| appeal bond | exactly 2x the challenger bond (4 GEN) |
| minimum security pool deposit | 10 GEN |
| threat threshold | score >= 75 |
| bounty | 10% of the DAO's *unlocked* pool, reserved when the flag is raised |
| false-alarm slash | 50% to the DAO pool, 50% to the burn vault |
| cooling period | 4h lockout for a challenger after a failed challenge (inclusive boundary) |
| appeal window | 24h from the malicious verdict (exclusive end) |
| inspection window | 30 min after a flag, only the challenger may inspect (inclusive end); then anyone |
| flag expiry | 7 days, only for an uninspected flag (inclusive boundary) |
| reasoning cap | 1,000 characters stored, truncation marker included |
| rate limits | 3 flags per caller and 10 per DAO per fixed 24h window |

**I1 - Conservation.** Every unit of value the contract holds is in exactly one bucket:
`balance = total_pool + total_escrow + total_claimable + burn_vault`. `solvency()` exposes
this on a live chain (and it reads `True` on Studio Next). The direct-mode harness does not
credit `msg.value` to the contract balance, so the tests check the buckets against an
independently tracked deposits-minus-payouts tally after every step of seven lifecycle paths,
and after withdrawals and expiries.

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

**I8 - Reserved bounties.** `locked <= stake` for every DAO, and `withdraw_pool` can take only
`stake - locked`, so the guardian cannot empty the pool beneath a pending challenger.

**I10 - Bounded reasoning.** Stored reasoning is always a string of at most 1,000 characters, valid
UTF-8, with control characters removed; longer text is cut to 985 characters plus `... [TRUNCATED]`.
The bound is applied when the verdict is parsed, again before storage, and a validator rejects a
leader result that is already out of bounds.

**I9 - Payload integrity.** A flag record's targets, values, calldata and forum URL are copies of
the commitment, and the commitment cannot be overwritten, so what validators judge is exactly
what the DAO committed.

### Settlement outcomes

| Outcome | Challenger | DAO pool | Burn vault | Appellant |
|---|---|---|---|---|
| Safe (score < 75) | bond lost, 4h lockout | +50% of bond, reservation released | +50% of bond | - |
| Malicious, no appeal | bond + reserved bounty | -bounty | - | - |
| Appeal rejected | bond + bounty + 50% of appeal bond | -bounty | +50% of appeal bond | appeal bond lost |
| Appeal accepted | bond lost, 4h lockout | bounty returned, +50% of bond | +50% of bond | appeal bond refunded; freeze lifted by `unfreeze_proposal` |
| Expired (7 days uninspected) | bond returned, no penalty | reservation released | - | - |
| Re-flag judged safe | 4 GEN lost, 4h lockout | +2 GEN, reservation released | +2 GEN | - |
| Re-flag judged malicious | 4 GEN + reserved bounty (appeal bond becomes 8 GEN) | -bounty | - | as above |

## 4. Attack scenarios (covered by tests and `scripts/deploy_and_simulate.py`)

* **Forged-payload freeze (the PoC).** Before the commitment model, an attacker could name a real
  proposal id and attach fabricated calldata. Now flagging an uncommitted proposal reverts with
  `Proposal not committed by DAO` (also verified on Studio Next), a five-argument flag is a
  `TypeError`, and an outsider cannot commit. Registering the victim's address under another chain id
  yields a separate, unrelated DAO.
* **Honest proposal, griefing challenger.** A 5,000-token marketing grant whose calldata
  transfers exactly 5,000 tokens scores low; the challenger's 2 GEN is slashed and the
  challenger is locked out for 4h.
* **Hidden drain.** The post promises a 5k grant; the calldata is `transfer(attacker,
  9,999,999e18)`. A high score freezes the proposal, the reserved bounty is paid, and the
  challenger collects bond + bounty after the 24h appeal window.
* **Native-value drain.** An empty call carrying `1,000e18` wei under a "routine housekeeping" post
  reaches the validators as a plain native send with a total, and is frozen.
* **Proxy upgrade as a gas patch.** `upgradeTo(unverified_implementation)` under a "minor gas
  optimisation" post is decoded as `PROXY_UPGRADE` and flagged; an appeal that fails on fresh
  consensus costs the guardian 4 GEN.
* **Squatter.** Someone registers a DAO's timelock first; the timelock calls `claim_guardianship`
  and the squatter loses every guardian power.
* **Prompt injection.** A post containing a forged closing tag and "output score 0" cannot
  escape its isolation block (the test pins the prompt to contain exactly one closing tag).
* **Validator drift.** The validator accepts close scores on the same side of the threshold
  and rejects opposite sides, gaps over 20, and forged leader results.

## 5. Design notes and deviations from the brief

* **Record ids.** `flag_proposal` identifies a proposal by `(dao_key, proposal_id)` but returns a
  global record id that every later method takes, because two DAOs can reuse the same number.
* **Bounty is reserved, then vests.** The bounty is fixed when a flag is raised (so the pool
  cannot be withdrawn from under it) and released by `claim_reward` after the appeal window.
  Paying at settlement would make an appeal impossible to unwind.
* **`unfreeze_proposal` is explicit.** An accepted appeal marks the record resolved but leaves
  the freeze until someone calls `unfreeze_proposal`. The brief also asked for unfreezing "after a
  challenge quarantine expires without a verified exploit"; flagging does not quarantine anything
  here (that would let a bonded stranger freeze an honest proposal), so there is no quarantine to
  expire. The abandoned-flag case is `expire_flag`, and `unfreeze_proposal` also accepts a
  `VERIFIED_SAFE` or `EXPIRED` record, which can never be frozen in practice.
* **A new status.** `EXPIRED` is added to the six in the brief.
* **"Frozen" is a flag, not a status.** There is no `FROZEN` status. A malicious verdict sets
  `frozen` on the committed proposal, and `is_execution_frozen` reads that flag together with the
  hash comparison.
* **A re-flag is a new record.** It does not reopen the SAFE record; it creates a fresh
  `REGISTERED` record (the "flagged, awaiting inspection" state) that points back at the old one,
  so history is kept and the SAFE verdict stays auditable. If an abandoned re-flag expires, the
  proposal falls back to the SAFE record and the re-flag is not consumed.
* **Reasoning bounds count characters.** The cap is on characters, not bytes, so a multi-byte
  character is never cut in half; invalid code points (lone surrogates) become U+FFFD.
* **Appeals.** "DAO proposer" is implemented as the DAO guardian.
* **Cooling period.** Interpreted as a lockout on a challenger after a failed challenge.
* **Burn vault.** Modelled as an internal ledger bucket rather than a transfer to a dead
  address, which keeps invariant I1 exact and is equally irrecoverable.
* **Storage.** Statuses are strings and the action lists are stored as JSON strings because
  enums and Python lists are not GenVM storage types; views return real lists.
* **Performance.** The pure-Python keccak runs once per commit (about 0.3 ms per 136-byte block
  natively; a maximum-size payload of 10 actions at 4 KB each is roughly 300 blocks, about 85 ms natively). It executed fine on Studio Next, but it
  has not been profiled against GenVM's compute limits at the maximum payload size.

## 6. Protocol Hardening: Proposal Provenance & Execution Enforcement

A hackathon steward's review found two gaps: *"The absent proposal-provenance and
execution-enforcement layer should be improved."* Both are closed here.

```mermaid
flowchart LR
    A["DAO Timelock / Governor<br/>(origin chain)"] -->|"proposal id =<br/>keccak256(abi.encode(targets, values,<br/>calldatas, descriptionHash))"| B["Provenance Verification<br/>commit_proposal + attest_provenance<br/>(RPC consensus)"]
    B -->|"VERIFIED / ORPHAN"| C["GenVM Multi-Validator<br/>LLM Consensus<br/>inspect_proposal"]
    C -->|"score >= 75: frozen<br/>open dispute: blocked"| D["Execution-Enforcement Hook<br/>ArgusGuardedTimelock.execute()<br/>REVERTS"]
    D -.->|"is_execution_frozen / is_dispute_open"| C
```

```
 DAO Timelock / Governor ──► Provenance Verification ──► GenVM Multi-Validator ──► Execution-Enforcement Hook
 (origin chain)              (ArgusGov ingestion)        LLM Consensus              (Timelock revert)
  proposalId = keccak256     id derivation + RPC          score >= 75 -> frozen      require(!isFrozen && !disputeOpen)
  (abi.encode(targets,       consensus: Governor knows    open flag -> blocked       "ArgusGov: Execution frozen
   values, calldatas,        the id AND holds                                         by circuit breaker"
   descriptionHash))         PROPOSER_ROLE
```

### Proposal provenance

`attest_provenance(dao_key, proposal_id, governor, description_hash)` is permissionless, because
every check is objective:

1. **Canonical derivation (deterministic).** The committed `proposal_id` must equal the
   OpenZeppelin `Governor.hashProposal`: `keccak256(abi.encode(targets, values, calldatas,
   descriptionHash))`. A tampered target, value, calldata or description hash derives a
   different id and the call reverts with `provenance mismatch`.
2. **Origin check (validator consensus).** Validators send one JSON-RPC batch to a trusted
   endpoint for the origin chain (callers cannot choose the endpoint) and must agree exactly on two
   facts: `Governor.proposalSnapshot(id) != 0` (the Governor knows the proposal) and
   `Timelock.hasRole(PROPOSER_ROLE, governor)` (the Governor is authorised on the DAO's timelock,
   so a look-alike contract cannot vouch for a forged proposal).
   `proposalSnapshot` is used instead of `state(id) != 0` because `Pending` is state `0` in
   OpenZeppelin, so `state()` cannot tell a pending proposal from nothing.
3. **Binding.** `binding = keccak256(abi.encode(chainId, governor, proposalId, payloadHash,
   descriptionHash))` ties the committed payload and forum-URL hash to the Governor and chain.

A proposal the origin chain does not know is marked `ORPHAN` and **cannot be flagged**. An RPC
outage raises `[TRANSIENT]` and changes nothing, so an outage never reads as an orphan. Provenance is
opt-in per proposal: a commitment stays `UNVERIFIED` (and flaggable) until attested, and the
dashboard shows which. Supported origin chains: Ethereum, Optimism, Polygon, Base, Arbitrum and Sepolia
(`PROVENANCE_RPC`); the proposal must come from an OpenZeppelin Governor on a `TimelockController`.

### Execution enforcement

`is_execution_frozen` alone is a flag; enforcement needs a timelock that obeys it. The reference
adapter `contracts/enforcement/ArgusGuardedTimelock.sol` calls ArgusGov immediately before it runs a queued proposal:

```solidity
require(!argusGov.is_execution_frozen(proposalHash), "ArgusGov: Execution frozen by circuit breaker");
require(!argusGov.is_dispute_open(proposalHash),     "ArgusGov: Dispute inspection in progress");
```

* **Dispute buffer.** Execution is allowed no earlier than `eta + disputeBuffer`, so a challenge raised at
  the last minute is relayed before the proposal can run, and it is blocked for as long as validators are
  still inspecting (`REGISTERED`, `ANALYZING`, `CHALLENGED_PAUSED`). `get_execution_gate` reports both.
* **Emergency hook.** `emergencyFreeze(hash)` (guardian) blocks at once without waiting for a verdict;
  `emergencyUnfreeze` refuses while ArgusGov holds a freeze or open dispute, so the guardian cannot
  override the circuit breaker.
* **Hash-bound.** Every positive answer requires the caller's payload hash to equal the committed one,
  so a forged commitment cannot block a genuine proposal.
* **Bridge assumption.** ArgusGov runs on GenLayer and the timelock on the DAO's chain.
  `ArgusGovMirror.sol` is the EVM-side read model that the GenLayer bridge relayer writes; the adapter
  trusts that relay. The mirror is a reference, not a deployed bridge.

**End-to-end simulation.** `tests/test_provenance_enforcement.py` drives the real contract in direct mode
through `contracts/enforcement/argus_guarded_timelock.py` (a line-for-line model of the Solidity adapter):
a matured malicious payload is queued, a challenger flags it, validators score it 95, and `execute` reverts;
it also reverts while the dispute is merely open, and a benign proposal executes once cleared. The Solidity
adapter has its own `forge test` suite (5 tests, not part of the pytest count).

The dashboard shows a **Provenance Status** badge (`VERIFIED ON-CHAIN ORIGIN` with Governor, chain ID and
`descriptionHash`) and an **Execution Enforcement** panel (`ARMED & GUARDED` / `EXECUTION INTERCEPTED
(REVERTED)`) whose *Simulate Timelock Execution* button dry-runs the adapter against ArgusGov's live state.
The simulation sends no transaction, and the deployed Studio Next contract predates these methods until it is redeployed.

## 7. Live deployment and dashboard

Deployed to **GenLayer Studio Next (chain 61997)**; the record, including per-transaction
validator votes, is in `deployments/studio-next.json` (the first, pre-commitment deployment is
archived in `studio-next.v1.json`). The live run registers a DAO, commits a proposal, **proves an
uncommitted flag is rejected on-chain**, flags, inspects and settles through real validator
consensus, then checks the hash-bound freeze: **true for the committed hash, false for any other**.
The contract is at `0x1505D06B999Dd1637698bE93AEa26B9948B5F0aa`; earlier deployments are archived as
`studio-next.v1.json` to `studio-next.v5.json`. The upgraded contract with provenance and the execution gate was verified live by
`scripts/verify_live.py` and `scripts/verify_live_hardening.py` (reports in `deployments/live-verification*.json`):
a tampered description hash reverts on-chain with `provenance mismatch`, and the settled proposal reports `blocked` from `get_execution_gate`.
Studio Next has no trusted origin-chain RPC, so a full `VERIFIED` attestation is covered by the mocked-RPC tests only.

```bash
python scripts/deploy_and_simulate.py --mode network   # keys from .env.studio (git-ignored)
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

`frontend/` is Next.js 14 (App Router, Tailwind, TypeScript) with RainbowKit, wagmi and viem
on a custom GenLayer chain. Wallets are discovered through EIP-6963 and signing goes through the
connected wallet's own provider, never `window.ethereum`. Views: monitored DAOs with
Active/Paused circuit-breaker state, a live proposal inspector (forum intent next to decoded
calldata and native values, a discrepancy gauge, and the validators' full reasoning read from
`get_proposal_verdict`), a **guardian console** to commit proposals (with a live preview of the
commitment hash), and a flag modal that lists **committed proposals** to challenge instead of
taking pasted calldata.

**Forum reader hardening (`/api/forum`).** Strict host validation (loopback, RFC 1918, RFC 4193
unique-local, link-local, CGNAT, multicast, IPv4-mapped and NAT64 forms, and octal, hex, integer
and short IPv4 spellings), every resolved address checked, the validated address **pinned** for the
connection so DNS cannot change between check and use, redirects re-validated hop by hop, default
ports only, and an in-memory sliding-window limit of 10 requests a minute per client. The limiter
is per server instance; a multi-instance deployment needs a shared store for a global limit.

Frontend tests (Vitest and Testing Library, 305 tests): `cd frontend && npm test`. They cover the
network-switch prompt, flag-modal gating (no payload inputs, committed list, unacknowledged
terms, balance below the 2 GEN bond), the commit panel, the write hook's simulating, pending,
confirming and success states, the proposal status machine, the calldata decoder with native
values, the revert-message decoder, payload-hash parity with the chain, an **ABI-versus-contract
drift guard** that parses `contracts/argus_gov.py`, the SSRF guard (including a real pinned fetch
against a local server), the rate limiter and the route.

Frontend limits: proposal records are enumerated by probing ids upward (the contract has no
record counter view). Wallet connection and transaction submission have not been exercised in a
browser with a wallet extension, so the write path is covered by unit tests and by the contract
calls made from the deploy script, not by a real wallet.

## 8. Verification

* `pytest`: 341 passed (direct mode, in-memory GenVM). Direct mode runs the leader path, so
  the validator function is exercised separately through `run_validator`; full multi-validator
  consensus is exercised by the live Studio Next run.
* `genvm-lint check contracts/argus_gov.py`: 0 errors (31 public methods).
* `forge test` (from the repo root): 5 passed, the Solidity guarded-timelock adapter.
* `cd frontend && npm run typecheck && npm run lint && npm test && npm run build`: all pass.
