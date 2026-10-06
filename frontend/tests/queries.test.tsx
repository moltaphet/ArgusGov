import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readView } from "@/lib/genlayer";
import { useProposals } from "@/lib/queries";
import { DAO, DAO_KEY, GEN, PAYLOAD_HASH, TOKEN, withQuery } from "./helpers";

vi.mock("@/lib/genlayer", () => ({ readView: vi.fn(), sendWrite: vi.fn() }));

const record = (over: Record<string, unknown> = {}) => ({
  id: 1, dao_key: DAO_KEY, dao_address: DAO, dao_proposal_id: 42, forum_url: "https://forum.example-dao.org/t/42", targets: [TOKEN], values: [0],
  calldatas: ["0x"], proposed_at: 1000, challenger: "0xabc", challenger_bond: 2n * GEN, threat_score: 85, status: "FLAGGED_MALICIOUS",
  reasoning_hash: "", payload_hash: PAYLOAD_HASH, appellant: "", appeal_bond: 0, flagged_at: 2000, reward_amount: 12n * GEN, reward_claimed: false,
  resolution: "", is_reflag: false, ...over,
});

describe("proposal loading and the hash-bound freeze check", () => {
  beforeEach(() => {
    vi.mocked(readView).mockReset();
  });

  it("asks is_execution_frozen about the record's own committed payload, as raw bytes", async () => {
    vi.mocked(readView).mockImplementation(async (name: string, args?: unknown[]) => {
      if (name === "get_proposal") {
        if (args?.[0] === 1n) return record() as never;
        throw new Error("gen_call: execution failed");               // the list ends at the first unknown id
      }
      if (name === "is_execution_frozen") return true as never;
      throw new Error(`unexpected view ${String(name)}`);
    });
    const { result } = renderHook(() => useProposals(), { wrapper: withQuery() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = vi.mocked(readView).mock.calls.find(([name]) => name === "is_execution_frozen")!;
    expect(call[1]).toHaveLength(3);                                  // (dao_key, proposal_id, expected_payload_hash)
    const [key, id, hash] = call[1] as [string, bigint, Uint8Array];
    expect([key, id]).toEqual([DAO_KEY, 42n]);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash).toHaveLength(32);
    expect(Buffer.from(hash).toString("hex")).toBe(PAYLOAD_HASH.slice(2));
    expect(result.current.data?.[0].frozen).toBe(true);
  });

  it("treats a record without a usable hash as not frozen instead of failing the whole list", async () => {
    vi.mocked(readView).mockImplementation(async (name: string, args?: unknown[]) => {
      if (name === "get_proposal") {
        if (args?.[0] === 1n) return record({ payload_hash: "" }) as never;
        throw new Error("gen_call: execution failed");
      }
      throw new Error("is_execution_frozen must not be called without a hash");
    });
    const { result } = renderHook(() => useProposals(), { wrapper: withQuery() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].frozen).toBe(false);
  });

  it("carries the re-flag marker through to the proposal", async () => {
    vi.mocked(readView).mockImplementation(async (name: string, args?: unknown[]) => {
      if (name === "get_proposal") {
        if (args?.[0] === 1n) return record({ is_reflag: true }) as never;
        throw new Error("gen_call: execution failed");
      }
      return false as never;
    });
    const { result } = renderHook(() => useProposals(), { wrapper: withQuery() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].isReflag).toBe(true);
  });
});
