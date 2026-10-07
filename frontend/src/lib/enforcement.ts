import type { ProposalStatus } from "./types";

// Messages are the ones ArgusGuardedTimelock.sol reverts with.
export const FROZEN_REVERT = "ArgusGov: Execution frozen by circuit breaker";
export const DISPUTE_REVERT = "ArgusGov: Dispute inspection in progress";

/** Flag states in which validators have not finished, or are re-running, an inspection. */
const DISPUTE_OPEN: ReadonlySet<ProposalStatus> = new Set(["REGISTERED", "ANALYZING", "CHALLENGED_PAUSED"]);

export interface ExecutionGate {
  frozen: boolean;
  disputeOpen: boolean;
  blocked: boolean;
}

/** Mirrors ArgusGov.get_execution_gate for a proposal's latest flag record. */
export function executionGate(status: ProposalStatus | undefined, frozen: boolean): ExecutionGate {
  const disputeOpen = status !== undefined && DISPUTE_OPEN.has(status);
  return { frozen, disputeOpen, blocked: frozen || disputeOpen };
}

export type TimelockState = "ARMED_AND_GUARDED" | "EXECUTION_INTERCEPTED";

export const timelockState = (gate: ExecutionGate): TimelockState => (gate.blocked ? "EXECUTION_INTERCEPTED" : "ARMED_AND_GUARDED");

export interface SimulationStep { label: string; ok: boolean }
export interface SimulationResult { reverted: boolean; reason: string; steps: SimulationStep[] }

/**
 * Dry-runs ArgusGuardedTimelock.execute against ArgusGov's current gate. The checks run in the
 * adapter's order; the first failing one reverts the whole call and nothing downstream runs.
 */
export function simulateTimelockExecution(gate: ExecutionGate): SimulationResult {
  const steps: SimulationStep[] = [{ label: "Timelock delay + dispute buffer elapsed", ok: true }];
  steps.push({ label: "argusGov.is_execution_frozen(proposalHash) == false", ok: !gate.frozen });
  if (gate.frozen) return { reverted: true, reason: FROZEN_REVERT, steps };
  steps.push({ label: "argusGov.is_dispute_open(proposalHash) == false", ok: !gate.disputeOpen });
  if (gate.disputeOpen) return { reverted: true, reason: DISPUTE_REVERT, steps };
  steps.push({ label: "Execute payload on target contracts", ok: true });
  return { reverted: false, reason: "Executed", steps };
}
