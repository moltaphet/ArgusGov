import "./bigint";
import { ARGUS_ADDRESS, RPC_URL } from "./networks";

// genlayer-js is loaded lazily: it is browser/Node only and must not enter the
// server render of the app shell.
type Sdk = typeof import("genlayer-js");
type Client = ReturnType<Sdk["createClient"]>;
type Eip1193Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

async function chain(sdk: Sdk) {
  // Spread the SDK's own chain (consensus contract, validator defaults, studio
  // flag) and pin only the RPC endpoint.
  return { ...sdk.chains.studioDevnet, rpcUrls: { default: { http: [RPC_URL] } } };
}

let readClientPromise: Promise<Client> | null = null;

/** Read-only client: no wallet, no account. */
export function readClient(): Promise<Client> {
  if (!readClientPromise) {
    readClientPromise = import("genlayer-js").then(async (sdk) =>
      sdk.createClient({ chain: await chain(sdk) } as never),
    );
  }
  return readClientPromise;
}

export async function readView<T>(functionName: string, args: unknown[] = []): Promise<T> {
  const client = await readClient();
  return (await client.readContract({
    address: ARGUS_ADDRESS,
    functionName,
    args: args as never,
  })) as T;
}

export type WritePhase = "wallet" | "submitted" | "consensus" | "decided";

export interface WriteResult {
  hash: string;
  resultName?: string;
  executionResult?: string;
}

/**
 * Send a state-changing call. Signing is routed to the wagmi connector's own
 * EIP-1193 provider (EIP-6963 discovered), never to window.ethereum.
 */
export async function writeView(opts: {
  provider: Eip1193Provider;
  account: `0x${string}`;
  functionName: string;
  args: unknown[];
  value?: bigint;
  onPhase?: (phase: WritePhase, detail?: string) => void;
}): Promise<WriteResult> {
  const sdk = await import("genlayer-js");
  const client = sdk.createClient({
    chain: await chain(sdk),
    account: opts.account,
    provider: opts.provider,
  } as never);
  // Studio Next has no fee manager; the deposit comes from the live fee policy.
  const fees = await client.estimateTransactionFees();
  opts.onPhase?.("wallet");
  const hash = await client.writeContract({
    address: ARGUS_ADDRESS,
    functionName: opts.functionName,
    args: opts.args as never,
    value: opts.value ?? 0n,
    fees,
  } as never);
  opts.onPhase?.("submitted", hash);
  opts.onPhase?.("consensus", hash);
  const receipt = (await client.waitForTransactionReceipt({
    hash,
    waitUntil: "decided",
    retries: 200,
    interval: 3000,
  } as never)) as { resultName?: string; txExecutionResultName?: string };
  opts.onPhase?.("decided", hash);
  if (receipt.txExecutionResultName && receipt.txExecutionResultName !== "FINISHED_WITH_RETURN") {
    throw new Error(
      `The contract rejected the call (${receipt.txExecutionResultName}). Check the bond, rate limits and inputs.`,
    );
  }
  return { hash, resultName: receipt.resultName, executionResult: receipt.txExecutionResultName };
}
