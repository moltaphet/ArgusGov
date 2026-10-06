"use client";

import type { Proposal } from "@/lib/types";
import { useContractWrite } from "./useContractWrite";

/** DAO guardian appeal: posts exactly twice the challenger's bond inside the 24h window. */
export function useAppealFlag() {
  const write = useContractWrite("Appeal flag");
  const appeal = async (proposal: Pick<Proposal, "id" | "challengerBond">) =>
    (await write.run("appeal_flag", [BigInt(proposal.id)], { value: proposal.challengerBond * 2n })) !== null;
  return { ...write, appeal };
}
