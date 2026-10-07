"use client";

import { Lock, PlayCircle, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { executionGate, simulateTimelockExecution, timelockState, type SimulationResult } from "@/lib/enforcement";
import type { Proposal } from "@/lib/types";

/** Shows the connected Timelock's state and lets a visitor try to execute through the guard. */
export function ExecutionEnforcementPanel({ proposal }: { proposal: Proposal }) {
  const gate = executionGate(proposal.status, proposal.frozen);
  const state = timelockState(gate);
  const intercepted = state === "EXECUTION_INTERCEPTED";
  const [result, setResult] = useState<SimulationResult | null>(null);

  return (
    <section className={`surface-inset border px-4 py-3 ${intercepted ? "border-rose-400/30" : "border-emerald-400/20"}`} aria-label="Execution enforcement">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">Execution Enforcement</h3>
        <span className={`badge ${intercepted ? "badge-crit" : "badge-safe"}`} data-timelock-state={state}>
          {intercepted ? <ShieldX size={12} /> : <ShieldCheck size={12} />}
          {intercepted ? "EXECUTION INTERCEPTED (REVERTED)" : "ARMED & GUARDED"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        The DAO&apos;s ArgusGuardedTimelock asks ArgusGov before it runs a queued proposal. A verdict-frozen proposal, or one whose
        dispute is still being inspected, reverts instead of executing.
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <Row label="Timelock" value={`${proposal.daoAddress.slice(0, 8)}…${proposal.daoAddress.slice(-4)}`} />
        <Row label="Circuit breaker" value={gate.frozen ? "ENGAGED" : "Standing by"} tone={gate.frozen ? "crit" : undefined} />
        <Row label="Dispute inspection" value={gate.disputeOpen ? "IN PROGRESS" : "None open"} tone={gate.disputeOpen ? "warn" : undefined} />
      </dl>
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <button type="button" className="btn btn-glass" onClick={() => setResult(simulateTimelockExecution(gate))}>
          <PlayCircle size={15} /> Simulate Timelock Execution
        </button>
        {result && (
          <div role="status" aria-live="polite" className="min-w-[260px] flex-1 rounded-lg border border-white/[0.07] bg-black/20 p-3 font-mono text-[11.5px] leading-relaxed" data-reverted={result.reverted}>
            <ul className="space-y-0.5">
              {result.steps.map((s) => (
                <li key={s.label} className={s.ok ? "text-emerald-300" : "text-rose-300"}>{s.ok ? "✓" : "✗"} {s.label}</li>
              ))}
            </ul>
            <p className={`mt-2 flex items-center gap-1.5 font-semibold ${result.reverted ? "text-rose-300" : "text-emerald-300"}`}>
              {result.reverted && <Lock size={12} />} {result.reverted ? `REVERT: ${result.reason}` : "Execution would succeed: ArgusGov holds no block on this proposal."}
            </p>
          </div>
        )}
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-zinc-600">
        Dry run of the reference adapter (contracts/enforcement/ArgusGuardedTimelock.sol) against ArgusGov&apos;s live state for this proposal. No transaction is sent.
      </p>
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "crit" | "warn" }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-1 font-mono text-[12px] ${tone === "crit" ? "text-rose-300" : tone === "warn" ? "text-amber-300" : "text-zinc-100"}`}>{value}</dd>
    </div>
  );
}
