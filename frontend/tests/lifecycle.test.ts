import { describe, expect, it } from "vitest";
import { applyEvent, availableActions, isMalicious, type LifecycleState } from "@/lib/lifecycle";
import type { Proposal } from "@/lib/types";

const registered: LifecycleState = { status: "REGISTERED", score: 0 };

describe("proposal status machine", () => {
  it("moves REGISTERED to FLAGGED_MALICIOUS when the consensus score is 75 or more", () => {
    const analyzing = applyEvent(registered, { type: "inspect", score: 85 });
    expect(analyzing).toEqual({ status: "ANALYZING", score: 85 });
    expect(applyEvent(analyzing, { type: "settle" }).status).toBe("FLAGGED_MALICIOUS");
  });

  it.each([[0, "VERIFIED_SAFE"], [74, "VERIFIED_SAFE"], [75, "FLAGGED_MALICIOUS"], [100, "FLAGGED_MALICIOUS"]])(
    "score %i settles as %s", (score, expected) => {
      const settled = applyEvent(applyEvent(registered, { type: "inspect", score }), { type: "settle" });
      expect(settled.status).toBe(expected);
      expect(isMalicious(score)).toBe(expected === "FLAGGED_MALICIOUS");
    });

  it("walks an appeal through to RESOLVED_DISPUTED", () => {
    let s = applyEvent(applyEvent(registered, { type: "inspect", score: 90 }), { type: "settle" });
    s = applyEvent(s, { type: "appeal" });
    expect(s.status).toBe("CHALLENGED_PAUSED");
    expect(applyEvent(s, { type: "resolve", score: 20 }).status).toBe("RESOLVED_DISPUTED");
  });

  it("ignores events that are illegal from the current status", () => {
    expect(applyEvent(registered, { type: "settle" })).toBe(registered);
    expect(applyEvent(registered, { type: "appeal" })).toBe(registered);
    const safe = applyEvent(applyEvent(registered, { type: "inspect", score: 5 }), { type: "settle" });
    expect(applyEvent(safe, { type: "inspect", score: 99 })).toBe(safe);
    expect(applyEvent(safe, { type: "appeal" })).toBe(safe);
  });
});

const DAY = 24 * 3600;
const base: Proposal = {
  id: 1, daoAddress: "0xdao", daoProposalId: 7, forumUrl: "https://f.example", targets: [], calldatas: [], proposedAt: 1000,
  challenger: "0xCHALLENGER", challengerBond: 2n * 10n ** 18n, threatScore: 85, status: "FLAGGED_MALICIOUS", reasoningHash: "", payloadHash: "",
  appellant: "", appealBond: 0n, flaggedAt: 10_000, rewardAmount: 12n * 10n ** 18n, rewardClaimed: false, resolution: "", frozen: true,
};

describe("available actions", () => {
  const byId = (p: Proposal, ctx: Parameters<typeof availableActions>[1]) => Object.fromEntries(availableActions(p, ctx).map((a) => [a.id, a]));

  it("offers inspection for REGISTERED and settlement for ANALYZING", () => {
    expect(availableActions({ ...base, status: "REGISTERED" }, { now: 0 }).map((a) => a.id)).toEqual(["inspect"]);
    expect(availableActions({ ...base, status: "ANALYZING" }, { now: 0 }).map((a) => a.id)).toEqual(["settle"]);
    expect(availableActions({ ...base, status: "VERIFIED_SAFE" }, { now: 0 })).toEqual([]);
  });

  it("lets only the guardian appeal, and only inside the 24h window", () => {
    const inside = base.flaggedAt + DAY - 1;
    expect(byId(base, { now: inside, account: "0xguardian", guardian: "0xguardian" }).appeal.enabled).toBe(true);
    expect(byId(base, { now: inside, account: "0xother", guardian: "0xguardian" }).appeal.reason).toMatch(/guardian/i);
    expect(byId(base, { now: base.flaggedAt + DAY, account: "0xguardian", guardian: "0xguardian" }).appeal.enabled).toBe(false);
  });

  it("lets the challenger claim only after the window closes, and only once", () => {
    const closed = base.flaggedAt + DAY;
    expect(byId(base, { now: closed - 1, account: "0xchallenger" }).claim.enabled).toBe(false);
    expect(byId(base, { now: closed, account: "0xchallenger" }).claim.enabled).toBe(true);
    expect(byId(base, { now: closed, account: "0xother" }).claim.enabled).toBe(false);
    expect(byId({ ...base, rewardClaimed: true }, { now: closed, account: "0xchallenger" }).claim.enabled).toBe(false);
  });
});
