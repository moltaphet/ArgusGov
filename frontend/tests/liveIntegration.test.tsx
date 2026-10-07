// Live integration: the frontend's own read client and parsers against the deployed contract.
// Opt-in because it needs the network:  ARGUS_LIVE=1 npx vitest run tests/liveIntegration.test.tsx
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnforcementPanel } from "@/components/ExecutionEnforcementPanel";
import { executionGate, FROZEN_REVERT, DISPUTE_REVERT } from "@/lib/enforcement";
import { readView } from "@/lib/genlayer";
import { payloadHashToBytes } from "@/lib/payloadHash";
import { deriveGovernorProposalId, descriptionHashOf, provenanceView } from "@/lib/provenance";
import { loadCommitted, loadProposals, toCommitted, useVerdict } from "@/lib/queries";
import { ARGUS_ADDRESS } from "@/lib/networks";
import type { CommittedProposal, Proposal } from "@/lib/types";
import { withQuery } from "./helpers";

const live = process.env.ARGUS_LIVE === "1";
const STATUSES = ["REGISTERED", "ANALYZING", "VERIFIED_SAFE", "FLAGGED_MALICIOUS", "CHALLENGED_PAUSED", "RESOLVED_DISPUTED", "EXPIRED"];

describe.skipIf(!live)(`live contract ${ARGUS_ADDRESS}`, () => {
  let proposals: Proposal[] = [];
  let committed: CommittedProposal[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);

  beforeAll(async () => {
    process.on("unhandledRejection", onUnhandled);
    [proposals, committed] = await Promise.all([loadProposals(), loadCommitted()]);
  }, 120_000);
  afterEach(() => vi.restoreAllMocks());

  it("a. deserialises the proposal list and the settlement verdicts", async () => {
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    for (const p of proposals) {
      expect(STATUSES).toContain(p.status);
      expect(typeof p.daoProposalId).toBe("bigint");
      expect(p.payloadHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(p.targets.length).toBe(p.values.length);
    }
    const malicious = proposals.filter((p) => p.status === "FLAGGED_MALICIOUS");
    expect(malicious.length).toBeGreaterThan(0);
    for (const p of malicious) {
      expect(p.frozen).toBe(true);
      const { result } = renderHook(() => useVerdict(p.daoKey, p.daoProposalId), { wrapper: withQuery() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 60_000 });
      expect(result.current.data).toMatchObject({ flagged: true, isMalicious: true, payloadHash: p.payloadHash });
      expect(result.current.data!.threatScore).toBeGreaterThanOrEqual(75);
      expect(result.current.data!.reasoning.length).toBeGreaterThan(0);
    }
  }, 180_000);

  it("b. get_execution_gate and is_execution_blocked agree with the client's own gate", async () => {
    for (const p of proposals) {
      const hash = payloadHashToBytes(p.payloadHash);
      const gate: any = await readView("get_execution_gate", [p.daoKey, p.daoProposalId, hash]);
      const blocked = await readView<boolean>("is_execution_blocked", [p.daoKey, p.daoProposalId, hash]);
      const mine = executionGate(p.status, p.frozen);
      expect(gate).toMatchObject({ committed: true, hash_matches: true, frozen: mine.frozen, dispute_open: mine.disputeOpen, blocked: mine.blocked });
      expect(blocked).toBe(mine.blocked);
      const wrong: any = await readView("get_execution_gate", [p.daoKey, p.daoProposalId, new Uint8Array(32)]);
      expect(wrong).toMatchObject({ hash_matches: false, blocked: false });
    }
  }, 180_000);

  it("c. parses provenance for unverified (live) and verified (contract-shaped) commitments", () => {
    expect(committed.length).toBeGreaterThanOrEqual(3);
    for (const c of committed) {
      expect(typeof c.daoProposalId).toBe("bigint");
      expect(c.provenance.status).toBe("UNVERIFIED");
      expect(provenanceView(c).headline).toBe("PROVENANCE UNVERIFIED");
    }
    // The commitment under a real Governor id: a 77-digit id must survive parsing exactly.
    const bound = committed.find((c) => c.daoProposalId > 2n ** 128n)!;
    expect(bound).toBeDefined();
    const desc = descriptionHashOf("# Marketing grant\nFund Q3 marketing.");
    expect(deriveGovernorProposalId(bound.targets, bound.values, bound.calldatas, desc)).toBe(bound.daoProposalId);
    // Chain 61997 has no trusted RPC, so VERIFIED cannot occur live: parse the contract's VERIFIED shape.
    const raw = { dao_key: bound.daoKey, dao_address: bound.daoAddress, chain_id: bound.chainId, dao_proposal_id: String(bound.daoProposalId),
      forum_url: bound.forumUrl, targets: bound.targets, values: bound.values.map(String), calldatas: bound.calldatas, payload_hash: bound.payloadHash,
      committed_by: bound.committedBy, committed_at: bound.committedAt, flag_id: 0, provenance_status: "VERIFIED",
      governor: "0x" + "c0".repeat(20), description_hash: desc, provenance_binding: "0x" + "11".repeat(32), provenance_at: 9 };
    const view = provenanceView(toCommitted(raw));
    expect(view).toMatchObject({ status: "VERIFIED", headline: "VERIFIED ON-CHAIN ORIGIN", idMatches: true, chainId: bound.chainId });
  });

  it("smoke: the Execution Enforcement panel and simulation match the live gate with no console errors or rejections", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const p of proposals) {
      const { unmount } = render(<ExecutionEnforcementPanel proposal={p} />);
      const gate: any = await readView("get_execution_gate", [p.daoKey, p.daoProposalId, payloadHashToBytes(p.payloadHash)]);
      expect(screen.getByText(gate.blocked ? "EXECUTION INTERCEPTED (REVERTED)" : "ARMED & GUARDED")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /simulate timelock execution/i }));
      const out = screen.getByRole("status");
      if (gate.blocked) expect(out).toHaveTextContent(gate.frozen ? FROZEN_REVERT : DISPUTE_REVERT);
      else expect(out).toHaveTextContent(/Execution would succeed/);
      unmount();
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
    process.off("unhandledRejection", onUnhandled);
  }, 120_000);
});

describe("offline smoke", () => {
  it("panel and simulation never log errors for any lifecycle state", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    return import("./helpers").then(({ proposal }) => {
      for (const status of STATUSES) for (const frozen of [true, false]) {
        const { unmount } = render(<ExecutionEnforcementPanel proposal={proposal({ status: status as Proposal["status"], frozen })} />);
        fireEvent.click(screen.getByRole("button", { name: /simulate timelock execution/i }));
        expect(screen.getByRole("status")).toBeInTheDocument();
        unmount();
      }
      expect(errors).not.toHaveBeenCalled();
    });
  });
});
