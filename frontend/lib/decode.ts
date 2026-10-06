// Client-side mirror of the contract's deterministic calldata decoder, so the
// inspector can show exactly the ground truth the validators were given.
export type Severity = "critical" | "high" | "info";

export interface DecodedAction {
  index: number;
  target: string;
  selector: string;
  signature: string;
  category: string;
  severity: Severity;
  details: { label: string; value: string }[];
  summary: string;
}

const MAX_UINT256 = 2n ** 256n - 1n;

const SELECTORS: Record<string, { sig: string; category: string; severity: Severity }> = {
  a9059cbb: { sig: "transfer(address,uint256)", category: "TOKEN_TRANSFER", severity: "high" },
  "095ea7b3": { sig: "approve(address,uint256)", category: "TOKEN_APPROVAL", severity: "high" },
  "23b872dd": { sig: "transferFrom(address,address,uint256)", category: "TOKEN_TRANSFER_FROM", severity: "high" },
  a22cb465: { sig: "setApprovalForAll(address,bool)", category: "NFT_APPROVAL_ALL", severity: "high" },
  "40c10f19": { sig: "mint(address,uint256)", category: "MINT", severity: "critical" },
  a0712d68: { sig: "mint(uint256)", category: "MINT", severity: "critical" },
  f2fde38b: { sig: "transferOwnership(address)", category: "OWNERSHIP_TRANSFER", severity: "critical" },
  "715018a6": { sig: "renounceOwnership()", category: "OWNERSHIP_RENOUNCE", severity: "critical" },
  "3659cfe6": { sig: "upgradeTo(address)", category: "PROXY_UPGRADE", severity: "critical" },
  "4f1ef286": { sig: "upgradeToAndCall(address,bytes)", category: "PROXY_UPGRADE", severity: "critical" },
  "99a88ec4": { sig: "upgrade(address,address)", category: "PROXY_UPGRADE", severity: "critical" },
  "8f283970": { sig: "changeAdmin(address)", category: "PROXY_ADMIN_CHANGE", severity: "critical" },
  "2f2ff15d": { sig: "grantRole(bytes32,address)", category: "ROLE_GRANT", severity: "critical" },
  "3ccfd60b": { sig: "withdraw()", category: "WITHDRAW", severity: "high" },
  "2e1a7d4d": { sig: "withdraw(uint256)", category: "WITHDRAW", severity: "high" },
  f3fef3a3: { sig: "withdraw(address,uint256)", category: "WITHDRAW", severity: "high" },
};

const word = (args: string, i: number) => args.slice(i * 64, (i + 1) * 64);
const wordAddr = (args: string, i: number) => {
  const w = word(args, i);
  return w.length === 64 ? `0x${w.slice(24)}` : "(truncated)";
};
const wordInt = (args: string, i: number) => {
  const w = word(args, i);
  return w.length === 64 ? BigInt(`0x${w}`) : -1n;
};

function amountLabel(raw: bigint): string {
  if (raw < 0n) return "(truncated)";
  if (raw === MAX_UINT256) return "UNLIMITED (max uint256)";
  const whole = raw / 10n ** 18n;
  return `${raw.toString()} raw  (${whole.toLocaleString("en-US")} tokens at 18 decimals)`;
}

export function decodeAction(index: number, target: string, calldata: string): DecodedAction {
  const body = calldata.replace(/^0x/, "");
  const base = { index, target, selector: "", signature: "", details: [] as DecodedAction["details"] };
  if (body === "") {
    return { ...base, category: "NATIVE_TRANSFER", severity: "high", signature: "(empty calldata)",
      summary: `Plain native-token send to ${target}` };
  }
  if (body.length < 8) {
    return { ...base, category: "MALFORMED", severity: "high", signature: "(malformed)",
      summary: "Calldata shorter than a selector" };
  }
  const selector = body.slice(0, 8);
  const args = body.slice(8);
  const known = SELECTORS[selector];
  if (!known) {
    return { ...base, selector: `0x${selector}`, category: "UNKNOWN", severity: "high",
      signature: "(unknown selector)", summary: `Call with unrecognised selector 0x${selector}` };
  }
  const details: DecodedAction["details"] = [];
  switch (selector) {
    case "a9059cbb":
    case "095ea7b3":
    case "40c10f19":
    case "f3fef3a3":
      details.push({ label: selector === "095ea7b3" ? "spender" : "recipient", value: wordAddr(args, 0) });
      details.push({ label: "amount", value: amountLabel(wordInt(args, 1)) });
      break;
    case "23b872dd":
      details.push({ label: "from", value: wordAddr(args, 0) }, { label: "to", value: wordAddr(args, 1) },
        { label: "amount", value: amountLabel(wordInt(args, 2)) });
      break;
    case "a0712d68":
    case "2e1a7d4d":
      details.push({ label: "amount", value: amountLabel(wordInt(args, 0)) });
      break;
    case "f2fde38b":
    case "3659cfe6":
    case "4f1ef286":
    case "8f283970":
      details.push({ label: selector === "f2fde38b" ? "new owner" : selector === "8f283970" ? "new admin" : "new implementation", value: wordAddr(args, 0) });
      break;
    case "99a88ec4":
      details.push({ label: "proxy", value: wordAddr(args, 0) }, { label: "new implementation", value: wordAddr(args, 1) });
      break;
    case "2f2ff15d":
      details.push({ label: "role", value: `0x${word(args, 0)}` }, { label: "account", value: wordAddr(args, 1) });
      break;
    case "a22cb465":
      details.push({ label: "operator", value: wordAddr(args, 0) }, { label: "approved", value: String(wordInt(args, 1) !== 0n) });
      break;
  }
  return { ...base, selector: `0x${selector}`, signature: known.sig, category: known.category,
    severity: known.severity, details, summary: `${known.sig} on ${target}` };
}

export function decodeActions(targets: string[], calldatas: string[]): DecodedAction[] {
  return targets.map((t, i) => decodeAction(i, t, calldatas[i] ?? "0x"));
}
