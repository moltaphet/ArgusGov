import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { FlagProposalModal } from "@/components/FlagProposalModal";
import { GENLAYER_STUDIO_NEXT_ID } from "@/lib/contracts/chain";
import { committedProposal, GEN, WALLET, withQuery } from "./helpers";

vi.mock("wagmi", () => ({ useAccount: vi.fn(), useSwitchChain: vi.fn(), useBalance: vi.fn() }));
vi.mock("@/lib/genlayer", () => ({ sendWrite: vi.fn(), readView: vi.fn() }));

const switchChainAsync = vi.fn().mockResolvedValue({});

function wallet(chainId: number) {
  vi.mocked(useAccount).mockReturnValue({ address: WALLET, isConnected: true, chainId, connector: {} } as never);
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync, isPending: false } as never);
  vi.mocked(useBalance).mockReturnValue({ data: { value: 10n * GEN }, isLoading: false } as never);
}

const modal = () => render(<FlagProposalModal open onClose={() => undefined} committed={[committedProposal()]} />, { wrapper: withQuery() });

describe("network switch prompt", () => {
  beforeEach(() => switchChainAsync.mockClear());

  it("prompts to switch when the wallet is connected to another chain", async () => {
    wallet(1);
    modal();

    expect(screen.getByRole("alert")).toHaveTextContent(/wrong network/i);
    const button = screen.getByRole("button", { name: /switch to genlayer studio next/i });
    await userEvent.click(button);
    expect(switchChainAsync).toHaveBeenCalledWith({ chainId: GENLAYER_STUDIO_NEXT_ID });
    expect(screen.getByTestId("submit-blocker")).toHaveTextContent(/switch to genlayer studio next/i);
  });

  it("shows no prompt once the wallet is on chain 61997", () => {
    wallet(GENLAYER_STUDIO_NEXT_ID);
    modal();
    expect(screen.queryByRole("button", { name: /switch to genlayer studio next/i })).not.toBeInTheDocument();
  });
});
