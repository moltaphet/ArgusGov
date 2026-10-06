"use client";

import { useQuery } from "@tanstack/react-query";
import { readView } from "./genlayer";
import { MONITORED_DAOS } from "./networks";
import { toBig } from "./format";
import type { DaoSummary, Ledger, Proposal, ProposalStatus, SecurityPool } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toProposal(raw: any, frozen: boolean): Proposal {
  return {
    id: Number(raw.id),
    daoAddress: String(raw.dao_address),
    daoProposalId: Number(raw.dao_proposal_id),
    forumUrl: String(raw.forum_url),
    targets: raw.targets ?? [],
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
    frozen,
  };
}

/** Proposals are enumerated by probing ids 1..n until the contract reverts. */
async function loadProposals(): Promise<Proposal[]> {
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
      frozen = Boolean(await readView<boolean>("is_execution_frozen", [raw.dao_address, BigInt(raw.dao_proposal_id)]));
    } catch {
      /* freeze flag is best-effort */
    }
    out.push(toProposal(raw, frozen));
  }
  return out;
}

async function loadPool(dao: string): Promise<SecurityPool | null> {
  try {
    const raw = await readView<any>("get_security_pool", [dao]);
    if (!raw.guardian) return null;
    return {
      daoAddress: dao,
      guardian: String(raw.guardian),
      stake: toBig(raw.stake),
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

export function useDaos() {
  const proposals = useProposals();
  const addresses = Array.from(
    new Set([...MONITORED_DAOS, ...(proposals.data ?? []).map((p) => p.daoAddress.toLowerCase())]),
  );
  const daos = useQuery({
    queryKey: ["daos", addresses.join(",")],
    enabled: proposals.isSuccess,
    refetchInterval: 15_000,
    queryFn: async (): Promise<DaoSummary[]> =>
      Promise.all(
        addresses.map(async (address) => {
          const list = (proposals.data ?? []).filter((p) => p.daoAddress.toLowerCase() === address);
          return { address, pool: await loadPool(address), proposals: list, paused: list.some((p) => p.frozen) };
        }),
      ),
  });
  return { daos, proposals };
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
