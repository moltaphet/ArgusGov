"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { formatGen, shortAddress } from "@/lib/format";
import { EXPLORER_URL } from "@/lib/networks";
import type { DaoSummary } from "@/lib/types";

export function DaoPanel({ daos, loading, error }: { daos?: DaoSummary[]; loading: boolean; error: boolean }) {
  return (
    <section className="glass p-6 rise" aria-labelledby="dao-heading">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="dao-heading" className="text-lg font-semibold">Monitored DAOs</h2>
        <span className="text-xs text-[var(--faint)]">{daos?.length ?? 0} watched</span>
      </div>
      {loading && <div className="glass-inner h-24 animate-pulse" />}
      {error && <p className="text-sm text-[var(--red)]">Could not reach Studio Next. Retrying…</p>}
      <ul className="space-y-3">
        {daos?.map((dao) => {
          const open = dao.proposals.filter((p) => ["REGISTERED", "ANALYZING"].includes(p.status)).length;
          const frozen = dao.proposals.filter((p) => p.frozen).length;
          return (
            <li key={dao.address} className="glass-inner p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a className="mono block truncate text-[var(--muted)] hover:text-white" href={`${EXPLORER_URL}/address/${dao.address}`} target="_blank" rel="noreferrer">
                    {shortAddress(dao.address, 8, 6)}
                  </a>
                  <div className="mt-1 text-xs text-[var(--faint)]">
                    {dao.pool ? `Security pool ${formatGen(dao.pool.stake)} GEN` : "Not registered with ArgusGov"}
                  </div>
                </div>
                <CircuitState paused={dao.paused} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <Stat label="Flags" value={dao.proposals.length} />
                <Stat label="Open" value={open} />
                <Stat label="Frozen" value={frozen} tone={frozen ? "var(--red)" : undefined} />
              </dl>
            </li>
          );
        })}
      </ul>
      {daos?.length === 0 && !loading && <p className="text-sm text-[var(--muted)]">No DAOs registered yet.</p>}
    </section>
  );
}

function CircuitState({ paused }: { paused: boolean }) {
  const color = paused ? "var(--red)" : "var(--green)";
  const Icon = paused ? ShieldAlert : ShieldCheck;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
      title={paused ? "At least one proposal is frozen" : "No proposal is frozen"}
    >
      <Icon size={14} className={paused ? "breathe" : ""} />
      {paused ? "Paused" : "Active"}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-black/20 py-2">
      <dd className="text-base font-semibold tabular-nums" style={{ color: tone }}>{value}</dd>
      <dt className="text-[var(--faint)]">{label}</dt>
    </div>
  );
}
