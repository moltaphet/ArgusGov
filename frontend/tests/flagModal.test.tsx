import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { FlagProposalModal } from "@/components/FlagProposalModal";
import { GENLAYER_STUDIO_NEXT_ID } from "@/lib/contracts/chain";
import { readView, sendWrite } from "@/lib/genlayer";
import type { CommittedProposal } from "@/lib/types";
import { committedProposal, DAO_KEY, GEN, WALLET, withQuery } from "./helpers";

vi.mock("wagmi", () => ({ useAccount: vi.fn(), useSwitchChain: vi.fn(), useBalance: vi.fn() }));
vi.mock("@/lib/genlayer", () => ({ sendWrite: vi.fn(), readView: vi.fn() }));

function setup(balance: bigint, committed: CommittedProposal[] = [committedProposal()]) {
  vi.mocked(useAccount).mockReturnValue({
    address: WALLET, isConnected: true, chainId: GENLAYER_STUDIO_NEXT_ID, connector: { getProvider: async () => ({ request: vi.fn() }) },
  } as never);
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn(), isPending: false } as never);
  vi.mocked(useBalance).mockReturnValue({ data: { value: balance }, isLoading: false } as never);
  render(<FlagProposalModal open onClose={() => undefined} committed={committed} />, { wrapper: withQuery() });
  return { submit: () => screen.getByRole("button", { name: /post 2 gen bond/i }) };
}

/** Contract views as a healthy, registered, committed, unflagged, cooled-down proposal. */
function healthyChain(overrides: Record<string, unknown> = {}) {
  vi.mocked(readView).mockImplementation(async (name: string) => {
    if (name in overrides) {
      const value = overrides[name];
      if (value instanceof Error) throw value;
      return value as never;
    }
    if (name === "get_security_pool") return { guardian: "0x1" } as never;
    if (name === "get_committed_proposal") return { flag_id: 0 } as never;
    return 0 as never;
  });
}

describe("flag proposal modal", () => {
  beforeEach(() => healthyChain());

  it("offers only committed proposals nobody has flagged", () => {
    setup(10n * GEN, [
      committedProposal({ daoProposalId: 1 }),
      committedProposal({ daoProposalId: 2, flagId: 7 }),          // already flagged
      committedProposal({ daoProposalId: 3, frozen: true }),       // already frozen
    ]);
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Proposal #1");
  });

  it("has no calldata or target inputs: the challenger cannot supply a payload", () => {
    setup(10n * GEN);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByLabelText(/calldata/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/target/i)).not.toBeInTheDocument();
  });

  it("explains when nothing has been committed", () => {
    setup(10n * GEN, []);
    expect(screen.getByText(/no committed proposals are open for challenge/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("blocks submission until a proposal is chosen and the bond terms are acknowledged", async () => {
    const { submit } = setup(10n * GEN);
    const user = userEvent.setup();
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId("submit-blocker")).toHaveTextContent(/select a committed proposal/i);

    await user.click(screen.getByRole("radio"));
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId("submit-blocker")).toHaveTextContent(/acknowledge/i);

    await user.click(screen.getByRole("checkbox"));
    expect(submit()).toBeEnabled();
    expect(screen.queryByTestId("submit-blocker")).not.toBeInTheDocument();
  });

  it("shows the DAO's committed payload, decoded and read-only, once selected", async () => {
    setup(10n * GEN);
    await userEvent.click(screen.getByRole("radio"));
    const payload = screen.getByLabelText("Committed payload");
    expect(within(payload).getByText("transfer(address,uint256)")).toBeInTheDocument();
    expect(within(payload).getByText(/9,999,999 tokens/)).toBeInTheDocument();
    expect(within(payload).getByText(/committed by the dao/i)).toBeInTheDocument();
  });

  it("blocks submission and says so when the wallet cannot cover the 2 GEN bond", async () => {
    const { submit } = setup(1n * GEN);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("checkbox"));
    expect(submit()).toBeDisabled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/insufficient balance/i);
    expect(screen.getByTestId("submit-blocker")).toHaveTextContent(/below the 2 gen bond/i);
  });

  it("flags by (dao_key, proposal_id) alone, with exactly 2.0 GEN", async () => {
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      await opts.preflight?.();
      opts.onPhase?.("wallet");
      opts.onPhase?.("consensus", "0xhash");
      opts.onPhase?.("decided", "0xhash");
      return { hash: "0xhash" };
    });
    const { submit } = setup(10n * GEN);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit());

    await waitFor(() => expect(sendWrite).toHaveBeenCalledTimes(1));
    const call = vi.mocked(sendWrite).mock.calls[0][0];
    expect(call.functionName).toBe("flag_proposal");
    expect(call.value).toBe(2n * GEN);
    expect(call.args).toEqual([DAO_KEY, 42n]);                       // nothing else can be passed
    await waitFor(() => expect(screen.getByText("Registered & Monitored")).toBeInTheDocument());
  });

  it("reports an active cooling period before asking the wallet to sign", async () => {
    healthyChain({ get_cooldown_until: Math.floor(Date.now() / 1000) + 3600 });
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      await opts.preflight?.();
      throw new Error("preflight should have thrown");
    });
    const { submit } = setup(10n * GEN);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit());
    expect(await screen.findByText("Active cooling period")).toBeInTheDocument();
  });

  it("reports a proposal that is no longer committed or open", async () => {
    healthyChain({ get_committed_proposal: new Error("gen_call: execution failed") });
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      await opts.preflight?.();
      throw new Error("preflight should have thrown");
    });
    const { submit } = setup(10n * GEN);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit());
    expect(await screen.findByText("Proposal not committed")).toBeInTheDocument();
  });
});
