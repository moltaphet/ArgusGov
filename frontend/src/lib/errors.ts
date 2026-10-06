// Turns contract reverts, preflight failures and wallet errors into messages a
// person can act on. The contract's own revert strings are matched, so this table
// is the user-facing mirror of the `_fail(...)` messages in contracts/argus_gov.py.

export interface DecodedError {
  code: string;
  title: string;
  message: string;
  /** The raw message, kept for diagnostics. */
  raw: string;
}

/** A revert reported by the contract. `message` is the contract's own text. */
export class ContractRevertError extends Error {
  constructor(message: string, readonly txHash?: string) {
    super(message);
    this.name = "ContractRevertError";
  }
}

interface Rule { match: RegExp; code: string; title: string; message: string }

const RULES: Rule[] = [
  { match: /cooling period/i, code: "COOLING_PERIOD", title: "Active cooling period", message: "A recent challenge from this wallet was judged a false alarm. Flagging is locked for 4 hours after that." },
  { match: /re-flag bond must equal/i, code: "REFLAG_BOND_MISMATCH", title: "Re-flag bond required", message: "A proposal judged safe can be challenged once more, at exactly twice the base bond (4.0 GEN)." },
  { match: /re-flag limit reached/i, code: "REFLAG_LIMIT", title: "Re-flag limit reached", message: "This proposal has already been challenged a second time and judged safe again, so it cannot be flagged further." },
  { match: /challenge bond must equal/i, code: "BOND_MISMATCH", title: "Insufficient bond", message: "The challenge bond must be exactly 2.0 GEN, no more and no less." },
  { match: /appeal bond must equal/i, code: "APPEAL_BOND_MISMATCH", title: "Wrong appeal bond", message: "An appeal needs exactly twice the challenger's bond (4.0 GEN)." },
  { match: /rate limit exceeded for caller/i, code: "CALLER_RATE_LIMIT", title: "Rate limit reached", message: "This wallet has used its 3 flags for the current 24-hour window." },
  { match: /rate limit exceeded for dao/i, code: "DAO_RATE_LIMIT", title: "DAO rate limit reached", message: "This DAO has reached 10 flags in the current 24-hour window. Try again later." },
  { match: /already flagged/i, code: "ALREADY_FLAGGED", title: "Proposal already flagged", message: "This exact payload has already been adjudicated, so it may already be frozen. Check the inspector." },
  { match: /proposal not committed by dao/i, code: "NOT_COMMITTED", title: "Proposal not committed", message: "The DAO has not committed this proposal's payload, so it cannot be flagged. Only the guardian or timelock can commit it." },
  { match: /proposal already committed/i, code: "ALREADY_COMMITTED", title: "Already committed", message: "A proposal's commitment is write-once. This proposal id already has a payload on record." },
  { match: /only the dao guardian or the timelock/i, code: "NOT_AUTHORISED_TO_COMMIT", title: "Guardian or timelock only", message: "Only the DAO's guardian, or the timelock itself, can commit proposals." },
  { match: /only the timelock can claim guardianship/i, code: "NOT_TIMELOCK", title: "Timelock only", message: "Only the timelock address itself can take over the guardian role." },
  { match: /invalid dao_key/i, code: "BAD_DAO_KEY", title: "Invalid DAO key", message: "A DAO is identified as chain_id:0xaddress, for example 61997:0x1234…" },
  { match: /values must/i, code: "BAD_VALUES", title: "Check the native values", message: "Provide one non-negative amount per action, in wei." },
  { match: /freeze is still justified/i, code: "FREEZE_JUSTIFIED", title: "Freeze still justified", message: "A standing malicious verdict, or an appeal still in progress, keeps the proposal frozen." },
  { match: /proposal is not frozen/i, code: "NOT_FROZEN", title: "Not frozen", message: "This proposal is not currently frozen." },
  { match: /flag has not expired/i, code: "NOT_EXPIRED", title: "Flag has not expired", message: "An uninspected flag returns its bond after 7 days." },
  { match: /only an uninspected flag can expire/i, code: "CANNOT_EXPIRE", title: "Cannot expire", message: "Only a flag that validators have not yet inspected can expire." },
  { match: /amount exceeds withdrawable pool/i, code: "OVER_WITHDRAW", title: "Amount too large", message: "Part of the pool is reserved for the bounties of open flags." },
  { match: /dao not registered/i, code: "DAO_NOT_REGISTERED", title: "DAO not registered", message: "This timelock has no security pool on ArgusGov, so it cannot be challenged." },
  { match: /unsafe or invalid forum_url/i, code: "BAD_FORUM_URL", title: "Forum link rejected", message: "Use a public http(s) link. Private, local and credentialed URLs are refused." },
  { match: /equal-length/i, code: "BAD_ACTIONS", title: "Check the actions", message: "Provide 1 to 10 actions, each with one target and one calldata." },
  { match: /invalid address/i, code: "BAD_ADDRESS", title: "Invalid address", message: "Addresses must be 0x followed by 40 hex characters." },
  { match: /invalid calldata/i, code: "BAD_CALLDATA", title: "Invalid calldata", message: "Calldata must be even-length 0x hex of at most 8,192 characters." },
  { match: /not awaiting inspection/i, code: "NOT_AWAITING_INSPECTION", title: "Already inspected", message: "Validators have already scored this proposal." },
  { match: /no unsettled verdict/i, code: "NO_VERDICT", title: "Nothing to settle", message: "There is no recorded verdict waiting to be settled." },
  { match: /appeal window still open/i, code: "APPEAL_WINDOW_OPEN", title: "Appeal window still open", message: "The reward vests 24 hours after the verdict, once the DAO can no longer appeal." },
  { match: /appeal window closed/i, code: "APPEAL_WINDOW_CLOSED", title: "Appeal window closed", message: "Appeals must be filed within 24 hours of the verdict." },
  { match: /not appealable/i, code: "NOT_APPEALABLE", title: "Not appealable", message: "Only a malicious verdict that has not been appealed can be appealed." },
  { match: /only the dao guardian/i, code: "NOT_GUARDIAN", title: "Guardian only", message: "Only the wallet that registered this DAO can appeal on its behalf." },
  { match: /only the challenger/i, code: "NOT_CHALLENGER", title: "Challenger only", message: "Only the wallet that posted the bond can claim its reward." },
  { match: /reward already claimed/i, code: "ALREADY_CLAIMED", title: "Reward already claimed", message: "This reward has already moved to your claimable balance." },
  { match: /no vested reward/i, code: "NO_VESTED_REWARD", title: "No vested reward", message: "There is no reward to claim on this proposal right now." },
  { match: /nothing to claim/i, code: "NOTHING_TO_CLAIM", title: "Nothing to withdraw", message: "Your claimable balance is empty." },
  { match: /unknown proposal/i, code: "UNKNOWN_PROPOSAL", title: "Unknown proposal", message: "No proposal with that id exists on this contract." },
  { match: /\[LLM_ERROR\]/i, code: "LLM_ERROR", title: "Validators could not agree", message: "The model's answer was malformed, so consensus rotated. Nothing was recorded; try again." },
  { match: /\[TRANSIENT\]/i, code: "TRANSIENT", title: "Temporary network issue", message: "A validator could not reach an external resource. Try again shortly." },
  // Wallet and network failures
  { match: /user rejected|user denied|rejected the request|request rejected/i, code: "USER_REJECTED", title: "Request rejected", message: "You declined the request in your wallet. Nothing was sent." },
  { match: /insufficient funds|exceeds the balance/i, code: "INSUFFICIENT_FUNDS", title: "Insufficient funds", message: "The wallet cannot cover the bond plus network fees." },
  { match: /chain mismatch|wrong chain|unrecognized chain|switch.*chain/i, code: "WRONG_CHAIN", title: "Wrong network", message: "Switch your wallet to GenLayer Studio Next (chain 61997) and try again." },
  { match: /timed out|timeout/i, code: "TIMEOUT", title: "Still waiting on consensus", message: "The transaction was submitted but has not been decided yet. Check the explorer." },
];

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    // JSON.stringify returns undefined (not a string) for undefined and functions.
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function decodeContractError(error: unknown): DecodedError {
  const raw = rawMessage(error);
  const rule = RULES.find((r) => r.match.test(raw));
  if (rule) return { code: rule.code, title: rule.title, message: rule.message, raw };
  const cleaned = raw.replace(/^\[(EXPECTED|EXTERNAL)\]\s*/i, "").split("\n")[0].trim();
  return { code: "UNKNOWN", title: "Transaction failed", message: cleaned ? cleaned.slice(0, 220) : "The transaction could not be completed.", raw };
}
