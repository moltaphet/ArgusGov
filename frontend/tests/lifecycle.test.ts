import { describe, expect, it } from "vitest";
import { applyEvent, availableActions, isMalicious, type LifecycleState } from "@/lib/lifecycle";
import type { Proposal } from "@/lib/types";
import { proposal } from "./helpers";

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

  it("expires only an uninspected flag", () => {
    expect(applyEvent(registered, { type: "expire" }).status).toBe("EXPIRED");
    const analyzing = applyEvent(registered, { type: "inspect", score: 90 });
    expect(applyEvent(analyzing, { type: "expire" })).toBe(analyzing);       // a recorded verdict must be settled
    const expired = applyEvent(registered, { type: "expire" });
    expect(applyEvent(expired, { type: "inspect", score: 99 })).toBe(expired);
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
const base: Proposal = proposal({ challenger: "0xCHALLENGER" });

describe("available actions", () => {
  const byId = (p: Proposal, ctx: Parameters<typeof availableActions>[1]) => Object.fromEntries(availableActions(p, ctx).map((a) => [a.id, a]));

  it("offers inspection for REGISTERED and settlement for ANALYZING", () => {
    expect(availableActions({ ...base, status: "REGISTERED" }, { now: 0 }).map((a) => a.id)).toEqual(["inspect", "expire"]);
    expect(availableActions({ ...base, status: "ANALYZING" }, { now: 0 }).map((a) => a.id)).toEqual(["settle"]);
    expect(availableActions({ ...base, status: "VERIFIED_SAFE" }, { now: 0 })).toEqual([]);
    expect(availableActions({ ...base, status: "EXPIRED" }, { now: 0 })).toEqual([]);
  });

  it("lets an abandoned flag be reclaimed only after 7 days, inclusive", () => {
    const registered = { ...base, status: "REGISTERED" as const, proposedAt: 1_000 };
    const expiry = 1_000 + 7 * DAY;
    expect(byId(registered, { now: expiry - 1 }).expire.enabled).toBe(false);
    expect(byId(registered, { now: expiry - 1 }).expire.reason).toMatch(/7 days/);
    expect(byId(registered, { now: expiry }).expire.enabled).toBe(true);
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

  it("offers to lift the freeze only after an accepted appeal, and never for a standing verdict", () => {
    const accepted = { ...base, status: "RESOLVED_DISPUTED" as const, resolution: "APPEAL_ACCEPTED", frozen: true };
    expect(availableActions(accepted, { now: 0 }).map((a) => a.id)).toEqual(["unfreeze"]);
    expect(availableActions({ ...accepted, frozen: false }, { now: 0 })).toEqual([]);                        // already lifted
    expect(availableActions({ ...accepted, resolution: "APPEAL_REJECTED" }, { now: 0 })).toEqual([]);       // verdict stands
    expect(availableActions({ ...base, status: "CHALLENGED_PAUSED" }, { now: 0 })).toEqual([]);             // appeal still pending
  });
});
