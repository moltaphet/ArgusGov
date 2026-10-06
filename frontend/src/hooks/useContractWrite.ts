"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import type { ArgusGovWriteArgs, ArgusGovWriteName } from "@/lib/contracts/argusGovABI";
import { GENLAYER_STUDIO_NEXT_ID } from "@/lib/contracts/chain";
import { decodeContractError, type DecodedError } from "@/lib/errors";
import { sendWrite, type WritePhase } from "@/lib/genlayer";
import { upsertToast } from "@/lib/toast";

export type WriteStatus = "idle" | WritePhase | "error";

const PHASE_DETAIL: Record<string, string> = {
  simulating: "Checking the call before anything is signed.",
  wallet: "Confirm the request in your wallet.",
  submitted: "Transaction submitted to Studio Next.",
  consensus: "Validators are reaching consensus.",
  decided: "Consensus decided and recorded on-chain.",
};

/** Query keys that hold dashboard statistics, monitored proposals and the committed-proposal list. */
const DASHBOARD_KEYS = [["proposals"], ["committed"], ["daos"], ["ledger"], ["verdict"], ["consensus"]] as const;

export interface RunOptions {
  value?: bigint;
  preflight?: () => Promise<void>;
}

/**
 * Shared write machinery for every ArgusGov action. Status maps onto the familiar
 * wagmi vocabulary: isSimulating (preflight and fee estimate), isPending (waiting
 * for the wallet signature), isConfirming (validators deciding), isSuccess.
 * On success the dashboard queries are refetched.
 */
export function useContractWrite(label: string) {
  const { address, connector, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const toastId = useId();
  const [status, setStatus] = useState<WriteStatus>("idle");
  const [hash, setHash] = useState<string | undefined>();
  const [error, setError] = useState<DecodedError | undefined>();
  const inFlight = useRef(false);

  useEffect(() => {
    if (status === "idle") return;
    if (status === "error") {
      upsertToast({ id: toastId, title: error?.title ?? label, tone: "error", detail: error?.message, hash });
    } else {
      upsertToast({ id: toastId, title: label, tone: status === "decided" ? "success" : "pending", detail: PHASE_DETAIL[status], hash });
    }
  }, [status, hash, error, label, toastId]);

  const run = useCallback(
    async <N extends ArgusGovWriteName>(functionName: N, args: ArgusGovWriteArgs[N], options: RunOptions = {}): Promise<string | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setError(undefined);
      setHash(undefined);
      try {
        if (!address || !connector) throw new Error("Connect a wallet first.");
        if (chainId !== GENLAYER_STUDIO_NEXT_ID) await switchChainAsync({ chainId: GENLAYER_STUDIO_NEXT_ID });
        const provider = (await connector.getProvider()) as Parameters<typeof sendWrite>[0]["provider"];
        const result = await sendWrite({
          provider,
          account: address,
          functionName,
          args,
          value: options.value,
          preflight: options.preflight,
          onPhase: (phase, h) => {
            setStatus(phase);
            if (h) setHash(h);
          },
        });
        setHash(result.hash);
        setStatus("decided");
        await Promise.all(DASHBOARD_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })));
        return result.hash;
      } catch (e) {
        const txHash = (e as { txHash?: string }).txHash;
        if (txHash) setHash(txHash);
        setError(decodeContractError(e));
        setStatus("error");
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [address, connector, chainId, switchChainAsync, queryClient],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(undefined);
    setHash(undefined);
  }, []);

  return {
    status,
    hash,
    error,
    run,
    reset,
    isIdle: status === "idle",
    isSimulating: status === "simulating",
    isPending: status === "wallet",
    isConfirming: status === "submitted" || status === "consensus",
    isSuccess: status === "decided",
    isError: status === "error",
    busy: status === "simulating" || status === "wallet" || status === "submitted" || status === "consensus",
  };
}
