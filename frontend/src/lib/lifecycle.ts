import { PROTOCOL } from "./networks";
import type { Proposal, ProposalStatus } from "./types";

/** Mirrors the contract's state machine so the UI never offers an action the contract would reject. */
export type LifecycleEvent =
  | { type: "inspect"; score: number }
  | { type: "settle" }
  | { type: "appeal" }
  | { type: "resolve"; score: number }
  | { type: "expire" };

export interface LifecycleState {
  status: ProposalStatus;
  score: number;
}

export const isMalicious = (score: number): boolean => score >= PROTOCOL.threatThreshold;

/** Applies one contract event; returns the same state when the event is illegal from here. */
export function applyEvent(state: LifecycleState, event: LifecycleEvent): LifecycleState {
  switch (event.type) {
    case "inspect":
      return state.status === "REGISTERED" ? { status: "ANALYZING", score: event.score } : state;
    case "settle":
      return state.status === "ANALYZING" ? { ...state, status: isMalicious(state.score) ? "FLAGGED_MALICIOUS" : "VERIFIED_SAFE" } : state;
    case "appeal":
      return state.status === "FLAGGED_MALICIOUS" ? { ...state, status: "CHALLENGED_PAUSED" } : state;
    case "expire":
      return state.status === "REGISTERED" ? { ...state, status: "EXPIRED" } : state;
    case "resolve":
      return state.status === "CHALLENGED_PAUSED" ? { status: "RESOLVED_DISPUTED", score: event.score } : state;
  }
}

export type ActionId = "inspect" | "settle" | "appeal" | "claim" | "unfreeze" | "expire";

export interface ActionContext {
  /** Lower-case address of the connected wallet, if any. */
  account?: string;
  /** Lower-case address of the DAO's guardian, if known. */
  guardian?: string;
  /** Unix seconds. */
  now: number;
}

export interface ActionAvailability {
  id: ActionId;
  label: string;
  enabled: boolean;
  /** Why the action is unavailable, when it applies to this status but not to this wallet or moment. */
  reason?: string;
}

/** Actions relevant to a proposal's status, with the reason when the connected wallet cannot take them yet. */
export function availableActions(p: Proposal, ctx: ActionContext): ActionAvailability[] {
  const out: ActionAvailability[] = [];
  const windowEnd = p.flaggedAt + PROTOCOL.appealWindowSeconds;
  if (p.status === "REGISTERED") {
    out.push({ id: "inspect", label: "Inspect Consensus", enabled: true });
    const expiresAt = p.proposedAt + PROTOCOL.flagExpirySeconds;
    out.push({
      id: "expire", label: "Reclaim Abandoned Bond", enabled: ctx.now >= expiresAt,
      reason: ctx.now >= expiresAt ? undefined : "An uninspected flag can be reclaimed 7 days after it was raised.",
    });
  }
  if (p.status === "RESOLVED_DISPUTED" && p.resolution === "APPEAL_ACCEPTED" && p.frozen) {
    out.push({ id: "unfreeze", label: "Lift Freeze", enabled: true });
  }
  if (p.status === "ANALYZING") out.push({ id: "settle", label: "Execute Circuit Breaker", enabled: true });
  if (p.status === "FLAGGED_MALICIOUS") {
    const open = ctx.now < windowEnd;
    const isGuardian = Boolean(ctx.account && ctx.guardian && ctx.account === ctx.guardian);
    out.push({
      id: "appeal", label: "Appeal Flag", enabled: open && isGuardian,
      reason: !open ? "The 24h appeal window has closed." : !isGuardian ? "Only the DAO guardian can appeal." : undefined,
    });
    const isChallenger = Boolean(ctx.account && ctx.account === p.challenger.toLowerCase());
    out.push({
      id: "claim", label: "Claim Bounty", enabled: !open && isChallenger && !p.rewardClaimed,
      reason: p.rewardClaimed ? "Already claimed." : open ? "Vests when the appeal window closes." : !isChallenger ? "Only the challenger can claim." : undefined,
    });
  }
  return out;
}
