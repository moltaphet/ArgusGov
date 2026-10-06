"use client";

import { useContractWrite } from "./useContractWrite";

/** Lifts the execution freeze once an appeal was accepted. Permissionless, because the condition is objective. */
export function useUnfreezeProposal() {
  const write = useContractWrite("Lift freeze");
  const unfreeze = async (daoKey: string, proposalId: number) =>
    (await write.run("unfreeze_proposal", [daoKey.toLowerCase(), BigInt(proposalId)])) !== null;
  return { ...write, unfreeze };
}

/** Returns the bond of a flag that nobody inspected within 7 days. Permissionless. */
export function useExpireFlag() {
  const write = useContractWrite("Reclaim bond");
  const expire = async (recordId: number) => (await write.run("expire_flag", [BigInt(recordId)])) !== null;
  return { ...write, expire };
}
