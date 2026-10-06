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
