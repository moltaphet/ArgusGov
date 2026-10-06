import { defineChain } from "viem";

// GenLayer Studio Next. The RPC and explorer are overridable per deployment so
// pointing the dashboard at another Studio host is a configuration change.
export const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER_URL ?? "https://explorer-studio-next.genlayer.com";

export const GENLAYER_STUDIO_NEXT_ID = 61997;

export const genlayerStudioNext = defineChain({
  id: GENLAYER_STUDIO_NEXT_ID,
  name: "GenLayer Studio Next",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "GenLayer Explorer", url: EXPLORER_URL } },
  testnet: true,
});
