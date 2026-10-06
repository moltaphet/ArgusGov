import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEther } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { CHALLENGE_BOND, useFlagProposal } from "@/hooks/useFlagProposal";
import { GENLAYER_STUDIO_NEXT_ID } from "@/lib/contracts/chain";
import { readView, sendWrite } from "@/lib/genlayer";
import { ContractRevertError } from "@/lib/errors";
import { DAO, TOKEN, WALLET, makeClient, transferCalldata, EVIL, GEN, withQuery } from "./helpers";

vi.mock("wagmi", () => ({ useAccount: vi.fn(), useSwitchChain: vi.fn(), useBalance: vi.fn() }));
vi.mock("@/lib/genlayer", () => ({ sendWrite: vi.fn(), readView: vi.fn() }));

const tick = () => new Promise((r) => setTimeout(r, 0));
const input = { daoAddress: DAO.toUpperCase().replace("0X", "0x"), proposalId: "42", forumUrl: " https://forum.example-dao.org/t/42 ", targets: [TOKEN], calldatas: [transferCalldata(EVIL, 9n * GEN)] };

describe("useFlagProposal", () => {
  beforeEach(() => {
    vi.mocked(useAccount).mockReturnValue({
      address: WALLET, isConnected: true, chainId: GENLAYER_STUDIO_NEXT_ID, connector: { getProvider: async () => ({ request: vi.fn() }) },
    } as never);
    vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn(), isPending: false } as never);
    vi.mocked(readView).mockImplementation(async (name: string) => (name === "get_security_pool" ? { guardian: "0x1" } : 0) as never);
  });

  it("uses exactly 2.0 GEN as the bond", () => {
    expect(CHALLENGE_BOND).toBe(parseEther("2.0"));
  });

  it("moves through simulating, pending, confirming and success, then refetches the dashboard", async () => {
    // Each phase pauses on a gate so every intermediate state can be observed.
    const gates: Array<() => void> = [];
    const gate = () => new Promise<void>((resolve) => { gates.push(resolve); });
    const release = () => act(async () => { gates.shift()?.(); await tick(); });
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      opts.onPhase?.("simulating");
      await opts.preflight?.();
      await gate();
      opts.onPhase?.("wallet");
      await gate();
      opts.onPhase?.("submitted", "0xabc");
      await gate();
      opts.onPhase?.("consensus", "0xabc");
      await gate();
      return { hash: "0xabc" };
    });
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useFlagProposal(), { wrapper: withQuery(client) });

    expect(result.current.isIdle).toBe(true);
    let pending: Promise<boolean> = Promise.resolve(false);
    await act(async () => { pending = result.current.submit(input); await tick(); });
    expect(result.current.isSimulating).toBe(true);
    expect(result.current.busy).toBe(true);

    await release();
    expect(result.current.isPending).toBe(true); // waiting for the wallet signature
    await release();
    expect(result.current.isConfirming).toBe(true);
    expect(result.current.hash).toBe("0xabc");
    await release();
    expect(result.current.isConfirming).toBe(true); // validators deciding
    expect(result.current.isSuccess).toBe(false);

    await act(async () => { gates.shift()?.(); expect(await pending).toBe(true); });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.busy).toBe(false);

    const call = vi.mocked(sendWrite).mock.calls[0][0];
    expect(call.value).toBe(parseEther("2.0"));
    expect(call.args).toEqual([DAO, 42n, "https://forum.example-dao.org/t/42", [TOKEN], [input.calldatas[0]]]);

    const refetched = invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(refetched).toEqual(expect.arrayContaining(["proposals", "daos", "ledger"]));
  });

  it("decodes a contract revert into a readable error", async () => {
    vi.mocked(sendWrite).mockRejectedValue(new ContractRevertError("[EXPECTED] this proposal payload was already flagged", "0xdead"));
    const { result } = renderHook(() => useFlagProposal(), { wrapper: withQuery() });
    let ok = true;
    await act(async () => { ok = await result.current.submit(input); });
    expect(ok).toBe(false);
    expect(result.current.isError).toBe(true);
    expect(result.current.error?.title).toBe("Proposal already flagged");
    expect(result.current.hash).toBe("0xdead");
  });

  it("stops in preflight for an unregistered DAO without reaching the wallet", async () => {
    vi.mocked(readView).mockImplementation(async () => ({ guardian: "" }) as never);
    vi.mocked(sendWrite).mockImplementation(async (opts) => {
      await opts.preflight?.();
      throw new Error("wallet should not be reached");
    });
    const { result } = renderHook(() => useFlagProposal(), { wrapper: withQuery() });
    await act(async () => { await result.current.submit(input); });
    expect(result.current.error?.code).toBe("DAO_NOT_REGISTERED");
  });
});
