"use client";

import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { GENLAYER_STUDIO_NEXT_ID } from "@/lib/contracts/chain";

/** Wallet readiness for a payable action: connected, on the right chain, and funded. */
export function useChainGate(requiredWei: bigint) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const balance = useBalance({ address, chainId: GENLAYER_STUDIO_NEXT_ID, query: { enabled: Boolean(address) } });

  const wrongChain = isConnected && chainId !== GENLAYER_STUDIO_NEXT_ID;
  const funds = balance.data?.value;
  const insufficientFunds = isConnected && !wrongChain && funds !== undefined && funds < requiredWei;

  return {
    address,
    isConnected,
    wrongChain,
    isSwitching,
    balance: funds,
    balanceLoading: balance.isLoading,
    insufficientFunds,
    ready: isConnected && !wrongChain && !insufficientFunds,
    switchToStudioNext: () => switchChainAsync({ chainId: GENLAYER_STUDIO_NEXT_ID }),
  };
}
