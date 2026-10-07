import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExecutionEnforcementPanel } from "@/components/ExecutionEnforcementPanel";
import { DISPUTE_REVERT, executionGate, FROZEN_REVERT, simulateTimelockExecution, timelockState } from "@/lib/enforcement";
import { proposal } from "./helpers";

describe("execution gate", () => {
  it("is clear after a safe verdict and for a proposal nobody flagged", () => {
    expect(executionGate("VERIFIED_SAFE", false)).toEqual({ frozen: false, disputeOpen: false, blocked: false });
    expect(executionGate(undefined, false).blocked).toBe(false);
  });

  it.each(["REGISTERED", "ANALYZING", "CHALLENGED_PAUSED"] as const)("blocks while a dispute is %s", (status) => {
    const g = executionGate(status, false);
    expect(g.disputeOpen && g.blocked).toBe(true);
  });

  it("blocks once the circuit breaker froze the proposal", () => {
    expect(executionGate("FLAGGED_MALICIOUS", true)).toEqual({ frozen: true, disputeOpen: false, blocked: true });
    expect(timelockState(executionGate("FLAGGED_MALICIOUS", true))).toBe("EXECUTION_INTERCEPTED");
    expect(timelockState(executionGate("VERIFIED_SAFE", false))).toBe("ARMED_AND_GUARDED");
  });
});

describe("simulateTimelockExecution", () => {
  it("reverts with the breaker message and never reaches the payload", () => {
    const r = simulateTimelockExecution(executionGate("FLAGGED_MALICIOUS", true));
    expect(r.reverted).toBe(true);
    expect(r.reason).toBe(FROZEN_REVERT);
    expect(r.steps.some((s) => s.label.startsWith("Execute payload"))).toBe(false);
  });

  it("reverts while a dispute is being inspected", () => {
    expect(simulateTimelockExecution(executionGate("ANALYZING", false)).reason).toBe(DISPUTE_REVERT);
  });

  it("executes when ArgusGov holds no block", () => {
    const r = simulateTimelockExecution(executionGate("VERIFIED_SAFE", false));
    expect(r.reverted).toBe(false);
    expect(r.steps.every((s) => s.ok)).toBe(true);
  });
});

describe("ExecutionEnforcementPanel", () => {
  it("is ARMED & GUARDED for a cleared proposal and the simulation executes", () => {
    render(<ExecutionEnforcementPanel proposal={proposal({ status: "VERIFIED_SAFE", frozen: false })} />);
    expect(screen.getByText("ARMED & GUARDED")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /simulate timelock execution/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/Execution would succeed/);
  });

  it("shows EXECUTION INTERCEPTED (REVERTED) and the simulated call reverts when frozen", () => {
    render(<ExecutionEnforcementPanel proposal={proposal({ status: "FLAGGED_MALICIOUS", frozen: true })} />);
    expect(screen.getByText("EXECUTION INTERCEPTED (REVERTED)")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /simulate timelock execution/i }));
    expect(screen.getByRole("status")).toHaveTextContent(`REVERT: ${FROZEN_REVERT}`);
  });
});
