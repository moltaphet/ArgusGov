import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { FlagProposalModal } from "@/components/FlagProposalModal";
import { GENLAYER_STUDIO_NEXT_ID } from "@/lib/contracts/chain";
import { readView, sendWrite } from "@/lib/genlayer";
import { DAO, EVIL, GEN, TOKEN, WALLET, transferCalldata, withQuery } from "./helpers";

vi.mock("wagmi", () => ({ useAccount: vi.fn(), useSwitchChain: vi.fn(), useBalance: vi.fn() }));
vi.mock("@/lib/genlayer", () => ({ sendWrite: vi.fn(), readView: vi.fn() }));

const calldata = transferCalldata(EVIL, 9_999_999n * GEN);

function setup(balance: bigint) {
  vi.mocked(useAccount).mockReturnValue({
    address: WALLET, isConnected: true, chainId: GENLAYER_STUDIO_NEXT_ID, connector: { getProvider: async () => ({ request: vi.fn() }) },
  } as never);
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn(), isPending: false } as never);
  vi.mocked(useBalance).mockReturnValue({ data: { value: balance }, isLoading: false } as never);
  render(<FlagProposalModal open onClose={() => undefined} knownDaos={[DAO]} />, { wrapper: withQuery() });
  return { submit: () => screen.getByRole("button", { name: /post 2 gen bond/i }) };
}

async function fillValidForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("DAO timelock"), DAO);
  await user.type(screen.getByLabelText("Proposal id"), "42");
  await user.type(screen.getByLabelText("Forum URL"), "https://forum.example-dao.org/t/42");
  await user.type(screen.getByLabelText("Action 1 target"), TOKEN);
  await user.click(screen.getByLabelText("Action 1 calldata"));
  await user.paste(calldata);
  return user;
}

describe("flag proposal modal", () => {
  beforeEach(() => {
    vi.mocked(readView).mockImplementation(async (name: string) => (name === "get_security_pool" ? { guardian: "0x1" } : 0) as never);
  });

  it("blocks submission while the form is empty", () => {
    const { submit } = setup(10n * GEN);
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId("submit-blocker")).toHaveTextContent(/complete every field/i);
  });

  it("blocks submission until the bond terms are acknowledged", async () => {
    const { submit } = setup(10n * GEN);
    await fillValidForm();
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId("submit-blocker")).toHaveTextContent(/acknowledge/i);
  });

  it("blocks submission and says so when the wallet cannot cover the 2 GEN bond", async () => {
    const { submit } = setup(1n * GEN);
    const user = await fillValidForm();
    await user.click(screen.getByRole("checkbox"));
    expect(submit()).toBeDisabled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/insufficient balance/i);
    expect(screen.getByTestId("submit-blocker")).toHaveTextContent(/below the 2 gen bond/i);
  });

  it("submits exactly 2.0 GEN with normalised arguments once everything is valid", async () => {
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      await opts.preflight?.();
      opts.onPhase?.("wallet");
      opts.onPhase?.("consensus", "0xhash");
      opts.onPhase?.("decided", "0xhash");
      return { hash: "0xhash" };
    });
    const { submit } = setup(10n * GEN);
    const user = await fillValidForm();
    await user.click(screen.getByRole("checkbox"));
    expect(submit()).toBeEnabled();

    await user.click(submit());
    await waitFor(() => expect(sendWrite).toHaveBeenCalledTimes(1));
    const call = vi.mocked(sendWrite).mock.calls[0][0];
    expect(call.functionName).toBe("flag_proposal");
    expect(call.value).toBe(2n * GEN);
    expect(call.args).toEqual([DAO, 42n, "https://forum.example-dao.org/t/42", [TOKEN], [calldata]]);
    await waitFor(() => expect(screen.getByText("Registered & Monitored")).toBeInTheDocument());
  });

  it("reports an active cooling period before asking the wallet to sign", async () => {
    vi.mocked(readView).mockImplementation(async (name: string) =>
      (name === "get_security_pool" ? { guardian: "0x1" } : Math.floor(Date.now() / 1000) + 3600) as never);
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      await opts.preflight?.();
      throw new Error("preflight should have thrown");
    });
    const { submit } = setup(10n * GEN);
    const user = await fillValidForm();
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit());
    expect(await screen.findByText("Active cooling period")).toBeInTheDocument();
  });
});
