import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

export function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

export function withQuery(client = makeClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

export const GEN = 10n ** 18n;
export const DAO = "0x" + "d1".repeat(20);
export const TOKEN = "0x" + "70".repeat(20);
export const EVIL = "0x" + "ee".repeat(20);
export const WALLET = "0x" + "ab".repeat(20);

const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
export const transferCalldata = (to: string, amount: bigint) => "0xa9059cbb" + word(to) + word(amount.toString(16));
export const approveCalldata = (spender: string, amount: bigint) => "0x095ea7b3" + word(spender) + word(amount.toString(16));

import type { CommittedProposal, Proposal } from "@/lib/types";

export const CHAIN = 61997;
export const DAO_KEY = `${CHAIN}:${DAO}`;
export const FORUM = "https://forum.example-dao.org/t/42";
export const PAYLOAD_HASH = "0x" + "ab".repeat(32);

export function committedProposal(over: Partial<CommittedProposal> = {}): CommittedProposal {
  return {
    daoKey: DAO_KEY, daoAddress: DAO, chainId: CHAIN, daoProposalId: 42, forumUrl: FORUM, targets: [TOKEN], values: [0n],
    calldatas: [transferCalldata(EVIL, 9_999_999n * GEN)], payloadHash: PAYLOAD_HASH, committedBy: WALLET, committedAt: 1000,
    flagId: 0, reflagCount: 0, flagStatus: "", flaggable: true, requiredBond: 2n * GEN, frozen: false,
    provenance: { status: "UNVERIFIED", governor: "", descriptionHash: "", binding: "", attestedAt: 0 }, ...over,
  };
}

export function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 1, daoKey: DAO_KEY, daoAddress: DAO, daoProposalId: 42, forumUrl: FORUM, targets: [TOKEN], values: [0n], calldatas: [],
    proposedAt: 1000, challenger: "0xCHALLENGER", challengerBond: 2n * GEN, threatScore: 85, status: "FLAGGED_MALICIOUS",
    reasoningHash: "", payloadHash: PAYLOAD_HASH, appellant: "", appealBond: 0n, flaggedAt: 10_000, rewardAmount: 12n * GEN,
    rewardClaimed: false, resolution: "", isReflag: false, frozen: true, ...over,
  };
}
