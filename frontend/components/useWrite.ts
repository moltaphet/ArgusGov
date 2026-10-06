"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { writeView, type WritePhase } from "@/lib/genlayer";
import { genlayerStudioNext } from "@/lib/networks";

export type WriteState =
  | { phase: "idle" }
  | { phase: WritePhase; hash?: string }
  | { phase: "error"; message: string };

export const PHASE_LABEL: Record<string, string> = {
  wallet: "Confirm in your wallet",
  submitted: "Transaction submitted",
  consensus: "Validators are reaching consensus",
  decided: "Consensus decided",
};

/** Runs a contract write through the connected wallet's EIP-1193 provider. */
export function useWrite() {
  const { address, connector, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [state, setState] = useState<WriteState>({ phase: "idle" });

  async function run(functionName: string, args: unknown[], value = 0n): Promise<boolean> {
    if (!address || !connector) {
      setState({ phase: "error", message: "Connect a wallet first." });
      return false;
    }
    try {
      if (chainId !== genlayerStudioNext.id) await switchChainAsync({ chainId: genlayerStudioNext.id });
      const provider = (await connector.getProvider()) as Parameters<typeof writeView>[0]["provider"];
      setState({ phase: "wallet" });
      const result = await writeView({
        provider,
        account: address,
        functionName,
        args,
        value,
        onPhase: (phase, hash) => setState({ phase, hash }),
      });
      setState({ phase: "decided", hash: result.hash });
      await queryClient.invalidateQueries();
      return true;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = /user rejected|denied/i.test(raw) ? "Request rejected in the wallet." : raw.split("\n")[0].slice(0, 240);
      setState({ phase: "error", message });
      return false;
    }
  }

  return { state, run, reset: () => setState({ phase: "idle" }), busy: ["wallet", "submitted", "consensus"].includes(state.phase) };
}
