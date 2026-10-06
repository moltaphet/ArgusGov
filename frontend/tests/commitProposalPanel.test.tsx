import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEther } from "viem";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { CommitProposalPanel } from "@/components/CommitProposalPanel";
import { GENLAYER_STUDIO_NEXT_ID } from "@/lib/contracts/chain";
import { shortAddress } from "@/lib/format";
import { readView, sendWrite } from "@/lib/genlayer";
import { computePayloadHash } from "@/lib/payloadHash";
import type { DaoSummary } from "@/lib/types";
import { DAO, DAO_KEY, EVIL, FORUM, GEN, TOKEN, WALLET, transferCalldata, withQuery } from "./helpers";

vi.mock("wagmi", () => ({ useAccount: vi.fn(), useSwitchChain: vi.fn(), useBalance: vi.fn() }));
vi.mock("@/lib/genlayer", () => ({ sendWrite: vi.fn(), readView: vi.fn() }));

const dao = (guardian: string): DaoSummary => ({
  key: DAO_KEY, address: DAO, chainId: GENLAYER_STUDIO_NEXT_ID, committed: [], proposals: [], paused: false,
  pool: { daoKey: DAO_KEY, daoAddress: DAO, guardian, stake: 100n * GEN, locked: 0n, withdrawable: 100n * GEN, minChallengeBond: 2n * GEN, coolingPeriod: 14400 },
});

function setup(account: string, daos: DaoSummary[]) {
  vi.mocked(useAccount).mockReturnValue({
    address: account, isConnected: true, chainId: GENLAYER_STUDIO_NEXT_ID, connector: { getProvider: async () => ({ request: vi.fn() }) },
  } as never);
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn(), isPending: false } as never);
  vi.mocked(useBalance).mockReturnValue({ data: { value: 5n * GEN }, isLoading: false } as never);
  render(<CommitProposalPanel daos={daos} />, { wrapper: withQuery() });
}

const calldata = transferCalldata(EVIL, 5_000n * GEN);

async function fill(user: ReturnType<typeof userEvent.setup>, opts: { value?: string } = {}) {
  await user.type(screen.getByLabelText("Proposal id"), "42");
  await user.type(screen.getByLabelText("Forum URL"), FORUM);
  await user.type(screen.getByLabelText("Action 1 target"), TOKEN);
  await user.clear(screen.getByLabelText("Action 1 native value"));
  await user.type(screen.getByLabelText("Action 1 native value"), opts.value ?? "0");
  await user.clear(screen.getByLabelText("Action 1 calldata"));
  await user.click(screen.getByLabelText("Action 1 calldata"));
  await user.paste(calldata);
}

const commitButton = () => screen.getByRole("button", { name: /commit proposal/i });

describe("commit proposal panel", () => {
  beforeEach(() => {
    vi.mocked(readView).mockImplementation(async (name: string) => {
      if (name === "get_security_pool") return { guardian: WALLET, dao_address: DAO } as never;
      if (name === "get_committed_proposal") throw new Error("not committed");
      return 0 as never;
    });
  });

  it("is closed to a wallet that is neither a guardian nor a timelock", () => {
    setup("0x" + "99".repeat(20), [dao(WALLET)]);
    expect(screen.getByTestId("not-guardian")).toHaveTextContent(/not the guardian/i);
    expect(screen.queryByLabelText("Proposal id")).not.toBeInTheDocument();
  });

  it("opens for the DAO's guardian", () => {
    setup(WALLET, [dao(WALLET)]);
    expect(screen.getByLabelText("Proposal id")).toBeInTheDocument();
    expect(screen.getByText(/guardian of 1 dao/i)).toBeInTheDocument();
  });

  it("opens for the timelock itself", () => {
    setup(DAO, [dao("0x" + "77".repeat(20))]);
    expect(screen.getByLabelText("Proposal id")).toBeInTheDocument();
  });

  it("stays disabled until the form is complete and valid", async () => {
    setup(WALLET, [dao(WALLET)]);
    expect(commitButton()).toBeDisabled();
    expect(screen.getByTestId("commit-blocker")).toHaveTextContent(/complete every field/i);
    const user = userEvent.setup();
    await fill(user, { value: "not a number" });
    expect(commitButton()).toBeDisabled();                       // an unparseable native value blocks it
    await user.clear(screen.getByLabelText("Action 1 native value"));
    await user.type(screen.getByLabelText("Action 1 native value"), "1.5");
    expect(commitButton()).toBeEnabled();
  });

  it("previews exactly the commitment the contract will compute", async () => {
    setup(WALLET, [dao(WALLET)]);
    const user = userEvent.setup();
    await fill(user, { value: "1.5" });
    const expected = computePayloadHash([TOKEN], [parseEther("1.5")], [calldata], FORUM);
    expect(screen.getByTestId("expected-hash")).toHaveTextContent(shortAddress(expected, 12, 8));
  });

  it("commits the payload with native values in wei", async () => {
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      await opts.preflight?.();
      opts.onPhase?.("consensus", "0xhash");
      opts.onPhase?.("decided", "0xhash");
      return { hash: "0xhash" };
    });
    setup(WALLET, [dao(WALLET)]);
    const user = userEvent.setup();
    await fill(user, { value: "1.5" });
    await user.click(commitButton());

    await waitFor(() => expect(sendWrite).toHaveBeenCalledTimes(1));
    const call = vi.mocked(sendWrite).mock.calls[0][0];
    expect(call.functionName).toBe("commit_proposal");
    expect(call.value ?? 0n).toBe(0n);                           // committing is free; only fees apply
    expect(call.args).toEqual([DAO_KEY, 42n, [TOKEN], [parseEther("1.5")], [calldata], FORUM]);
  });

  it("refuses a commitment for a proposal id that is already committed", async () => {
    vi.mocked(readView).mockImplementation(async (name: string) =>
      (name === "get_security_pool" ? { guardian: WALLET, dao_address: DAO } : { flag_id: 0 }) as never);
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      await opts.preflight?.();
      throw new Error("the wallet should not be reached");
    });
    setup(WALLET, [dao(WALLET)]);
    const user = userEvent.setup();
    await fill(user);
    await user.click(commitButton());
    expect(await screen.findByText("Already committed")).toBeInTheDocument();
  });

  it("refuses when the connected wallet lost the guardian seat on-chain", async () => {
    vi.mocked(readView).mockImplementation(async (name: string) =>
      (name === "get_security_pool" ? { guardian: "0x" + "55".repeat(20), dao_address: DAO } : 0) as never);
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      await opts.preflight?.();
      throw new Error("the wallet should not be reached");
    });
    setup(WALLET, [dao(WALLET)]);   // the cached list still says WALLET is guardian; the chain disagrees
    const user = userEvent.setup();
    await fill(user);
    await user.click(commitButton());
    expect(await screen.findByText("Guardian or timelock only")).toBeInTheDocument();
  });
});
