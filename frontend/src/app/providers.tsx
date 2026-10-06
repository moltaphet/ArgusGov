"use client";

import "@/lib/bigint";
import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, RainbowKitProvider, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

// Zinc-on-obsidian wallet dialogs that match the dashboard surfaces.
const base = darkTheme({ accentColor: "#27272a", accentColorForeground: "#fafafa", borderRadius: "medium", overlayBlur: "small", fontStack: "system" });
const theme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    modalBackground: "rgba(18, 18, 22, 0.88)",
    modalBorder: "rgba(255, 255, 255, 0.08)",
    profileForeground: "rgba(18, 18, 22, 0.92)",
    generalBorder: "rgba(255, 255, 255, 0.08)",
    menuItemBackground: "rgba(255, 255, 255, 0.05)",
    connectButtonBackground: "rgba(255, 255, 255, 0.05)",
    connectButtonInnerBackground: "rgba(255, 255, 255, 0.04)",
    connectButtonText: "#e4e4e7",
  },
  shadows: { ...base.shadows, dialog: "0 24px 80px rgba(0, 0, 0, 0.6)" },
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
