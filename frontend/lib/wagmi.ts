import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { genlayerStudioNext, RPC_URL } from "./networks";

// Wallets are discovered through EIP-6963: wagmi listens for announced
// providers and RainbowKit lists each one under "Installed". Nothing here
// reads window.ethereum, and no WalletConnect relay (or project id) is needed.
const connectors = connectorsForWallets(
  [{ groupName: "Detected wallets", wallets: [injectedWallet] }],
  { appName: "ArgusGov", projectId: "argusgov-eip6963-only" },
);

export const wagmiConfig = createConfig({
  chains: [genlayerStudioNext],
  connectors,
  transports: { [genlayerStudioNext.id]: http(RPC_URL) },
  multiInjectedProviderDiscovery: true,
  ssr: true,
});
