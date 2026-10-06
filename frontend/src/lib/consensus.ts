import "./bigint";
import deployment from "@/data/studio-next.json";
import { ARGUS_ADDRESS } from "./networks";
import { readClient } from "./genlayer";

export interface ConsensusInfo {
  hash: string;
  votes: string[];
  agree: number;
  total: number;
  /** True when a strict majority of the round's validators agreed. */
  verified: boolean;
  score?: number;
  isMalicious?: boolean;
  reasoning?: string;
  createdAt?: string;
}

const STORAGE_KEY = "argusgov.inspectTx";

function readStore(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Remember the inspection transaction the UI sent, so its receipt can be shown later. */
export function rememberInspectHash(proposalId: number, hash: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStore(), [proposalId]: hash }));
  } catch {
    /* storage unavailable: the receipt simply will not be linked */
  }
}

/** Inspection tx for a proposal: this browser's own sends first, then the recorded deployment. */
export function inspectHashFor(proposalId: number): string | undefined {
  const mine = typeof window !== "undefined" ? readStore()[proposalId] : undefined;
  if (mine) return mine;
  const record = deployment as { contract_address?: string; transactions?: { label: string; tx_hash: string; proposal_id?: number | null }[] };
  if (record.contract_address?.toLowerCase() !== ARGUS_ADDRESS.toLowerCase()) return undefined;
  return record.transactions?.find((t) => t.label === "inspect_proposal" && t.proposal_id === proposalId)?.tx_hash;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Reads the consensus receipt for a transaction and decodes the leader's verdict. */
export async function loadConsensus(hash: string): Promise<ConsensusInfo> {
  const [client, sdk] = await Promise.all([readClient(), import("genlayer-js")]);
  const tx = (await client.getTransaction({ hash: hash as `0x${string}` } as never)) as any;
  const round = tx.last_round ?? tx.lastRound ?? {};
  const votes: string[] = round.validator_votes_name ?? round.validatorVotesName ?? [];
  const agree = votes.filter((v) => v === "AGREE").length;
  const info: ConsensusInfo = {
    hash,
    votes,
    agree,
    total: votes.length,
    verified: votes.length > 0 && agree * 2 > votes.length,
    createdAt: tx.created_at ?? tx.createdAt,
  };
  try {
    const leader = (tx.consensus_data ?? tx.consensusData)?.leader_receipt?.[0];
    const raw: string | undefined = leader?.eq_outputs?.["0"]?.raw;
    if (raw) {
      // First byte is the VM status marker; the rest is GenVM calldata.
      const decoded = sdk.abi.calldata.decode(base64ToBytes(raw).slice(1)) as any;
      const read = (k: string) => (decoded instanceof Map ? decoded.get(k) : decoded?.[k]);
      info.reasoning = String(read("reasoning") ?? "");
      info.score = Number(read("score"));
      info.isMalicious = Boolean(read("is_malicious"));
    }
  } catch {
    /* receipt without a decodable leader output: show votes only */
  }
  return info;
}
