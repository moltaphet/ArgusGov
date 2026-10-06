"use client";

import { useQuery } from "@tanstack/react-query";
import { readView } from "./genlayer";
import { MONITORED_DAOS } from "./networks";
import { toBig } from "./format";
import { payloadHashToBytes } from "./payloadHash";
import type { CommittedProposal, DaoSummary, Ledger, Proposal, ProposalStatus, SecurityPool } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const daoAddressOf = (daoKey: string): string => daoKey.slice(daoKey.indexOf(":") + 1);
export const daoChainOf = (daoKey: string): number => Number(daoKey.slice(0, daoKey.indexOf(":")));

function toProposal(raw: any, frozen: boolean): Proposal {
  return {
    id: Number(raw.id),
    daoKey: String(raw.dao_key),
    daoAddress: String(raw.dao_address),
    daoProposalId: Number(raw.dao_proposal_id),
    forumUrl: String(raw.forum_url),
    targets: raw.targets ?? [],
    values: (raw.values ?? []).map(toBig),
    calldatas: raw.calldatas ?? [],
    proposedAt: Number(raw.proposed_at),
    challenger: String(raw.challenger),
    challengerBond: toBig(raw.challenger_bond),
    threatScore: Number(raw.threat_score),
    status: raw.status as ProposalStatus,
    reasoningHash: String(raw.reasoning_hash ?? ""),
    payloadHash: String(raw.payload_hash ?? ""),
    appellant: String(raw.appellant ?? ""),
    appealBond: toBig(raw.appeal_bond),
    flaggedAt: Number(raw.flagged_at),
    rewardAmount: toBig(raw.reward_amount),
    rewardClaimed: Boolean(raw.reward_claimed),
    resolution: String(raw.resolution ?? ""),
    isReflag: Boolean(raw.is_reflag),
    frozen,
  };
}

export function toCommitted(raw: any): CommittedProposal {
  return {
    daoKey: String(raw.dao_key),
    daoAddress: String(raw.dao_address),
    chainId: Number(raw.chain_id),
    daoProposalId: Number(raw.dao_proposal_id),
    forumUrl: String(raw.forum_url),
    targets: raw.targets ?? [],
    values: (raw.values ?? []).map(toBig),
    calldatas: raw.calldatas ?? [],
    payloadHash: String(raw.payload_hash ?? ""),
    committedBy: String(raw.committed_by ?? ""),
    committedAt: Number(raw.committed_at),
    flagId: Number(raw.flag_id),
    reflagCount: Number(raw.reflag_count ?? 0),
    flagStatus: String(raw.flag_status ?? ""),
    flaggable: Boolean(raw.flaggable),
    requiredBond: toBig(raw.required_bond),
    frozen: Boolean(raw.frozen),
  };
}

/**
 * The contract has no proposal counter, so the list ends at the first id it rejects.
 * genlayer-js logs that expected rejection with console.error; drop only that message
 * for the duration of the probe so it does not read as an application failure.
 */
async function withoutProbeNoise<T>(work: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("GenLayer RPC error (gen_call)")) return;
    original(...args);
  };
  try {
    return await work();
  } finally {
    console.error = original;
  }
}

/** Flag records are enumerated by probing ids 1..n until the contract reverts. */
function loadProposals(): Promise<Proposal[]> {
  return withoutProbeNoise(probeProposals);
}

async function probeProposals(): Promise<Proposal[]> {
  const out: Proposal[] = [];
  for (let id = 1; id <= 200; id++) {
    let raw: any;
    try {
      raw = await readView<any>("get_proposal", [BigInt(id)]);
    } catch {
      break;
    }
    let frozen = false;
    try {
      // The freeze check is bound to a payload hash. Asking with this record's own (committed) hash
      // answers "is this exact payload frozen?", which is what the dashboard shows.
      frozen = Boolean(await readView<boolean>("is_execution_frozen", [raw.dao_key, BigInt(raw.dao_proposal_id), payloadHashToBytes(String(raw.payload_hash))]));
    } catch {
      /* freeze flag is best-effort */
    }
    out.push(toProposal(raw, frozen));
  }
  return out;
}

async function loadCommitted(): Promise<CommittedProposal[]> {
  const count = Number(await readView<number>("get_committed_count"));
  const rows = await Promise.all(Array.from({ length: Math.min(count, 200) }, (_, i) => readView<any>("get_committed_at", [BigInt(i)])));
  return rows.map(toCommitted);
}

async function loadDaoKeys(): Promise<string[]> {
  const count = Number(await readView<number>("get_dao_count"));
  return Promise.all(Array.from({ length: Math.min(count, 200) }, (_, i) => readView<string>("get_dao_key_at", [BigInt(i)])));
}

async function loadPool(daoKey: string): Promise<SecurityPool | null> {
  try {
    const raw = await readView<any>("get_security_pool", [daoKey]);
    if (!raw.guardian) return null;
    return {
      daoKey,
      daoAddress: String(raw.dao_address),
      guardian: String(raw.guardian),
      stake: toBig(raw.stake),
      locked: toBig(raw.locked),
      withdrawable: toBig(raw.withdrawable),
      minChallengeBond: toBig(raw.min_challenge_bond),
      coolingPeriod: Number(raw.challenge_cooling_period),
    };
  } catch {
    return null;
  }
}

export function useProposals() {
  return useQuery({ queryKey: ["proposals"], queryFn: loadProposals, refetchInterval: 15_000 });
}

export function useCommitted() {
  return useQuery({ queryKey: ["committed"], queryFn: loadCommitted, refetchInterval: 15_000 });
}

export function useDaos() {
  const proposals = useProposals();
  const committed = useCommitted();
  const registered = useQuery({ queryKey: ["daos", "keys"], queryFn: loadDaoKeys, refetchInterval: 30_000 });
  const ready = proposals.isSuccess && registered.isSuccess;
  const keys = Array.from(
    new Set([
      ...MONITORED_DAOS,
      ...(registered.data ?? []),
      ...(proposals.data ?? []).map((p) => p.daoKey),
      ...(committed.data ?? []).map((c) => c.daoKey),
    ].map((k) => k.toLowerCase())),
  );
  const daos = useQuery({
    queryKey: ["daos", "summaries", keys.join(",")],
    enabled: ready,
    refetchInterval: 15_000,
    queryFn: async (): Promise<DaoSummary[]> =>
      Promise.all(
        keys.map(async (key) => {
          const list = (proposals.data ?? []).filter((p) => p.daoKey.toLowerCase() === key);
          return {
            key,
            address: daoAddressOf(key),
            chainId: daoChainOf(key),
            pool: await loadPool(key),
            proposals: list,
            committed: (committed.data ?? []).filter((c) => c.daoKey.toLowerCase() === key),
            paused: list.some((p) => p.frozen),
          };
        }),
      ),
  });
  return { daos, proposals, committed };
}

export function useLedger() {
  return useQuery({
    queryKey: ["ledger"],
    refetchInterval: 15_000,
    queryFn: async (): Promise<Ledger & { solvent: boolean }> => {
      const [raw, solvent] = await Promise.all([readView<any>("get_ledger"), readView<boolean>("solvency")]);
      return {
        pool: toBig(raw.total_pool),
        escrow: toBig(raw.total_escrow),
        claimable: toBig(raw.total_claimable),
        burnVault: toBig(raw.burn_vault),
        balance: toBig(raw.balance),
        solvent: Boolean(solvent),
      };
    },
  });
}

/** The on-chain verdict for a committed proposal, including the full reasoning text. */
export function useVerdict(daoKey: string, daoProposalId: number, enabled = true) {
  return useQuery({
    queryKey: ["verdict", daoKey, daoProposalId],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const v = await readView<any>("get_proposal_verdict", [daoKey, BigInt(daoProposalId)]);
      return {
        flagged: Boolean(v.flagged),
        status: String(v.status),
        threatScore: Number(v.threat_score),
        isMalicious: Boolean(v.is_malicious),
        reasoning: String(v.reasoning ?? ""),
        reasoningHash: String(v.reasoning_hash ?? ""),
        payloadHash: String(v.payload_hash ?? ""),
      };
    },
  });
}
