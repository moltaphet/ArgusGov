"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown, Wallet } from "lucide-react";
import { Identicon } from "./Identicon";

/** Minimal translucent wallet control, rendered on top of RainbowKit's modals. */
export function ConnectPill() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        return (
          <div aria-hidden={!ready} className={ready ? "" : "pointer-events-none opacity-0"}>
            {!connected ? (
              <button className="btn btn-glass" onClick={openConnectModal}>
                <Wallet size={15} className="text-zinc-400" /> Connect wallet
              </button>
            ) : chain.unsupported ? (
              <button className="btn btn-outline-rose" onClick={openChainModal}>Wrong network</button>
            ) : (
              <button className="btn btn-glass !pl-2" onClick={openAccountModal}>
                <Identicon address={account.address} size={22} />
                <span className="font-mono text-xs">{account.displayName}</span>
                <ChevronDown size={14} className="text-zinc-500" />
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
