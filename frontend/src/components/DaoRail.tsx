"use client";

import { Flag, Siren } from "lucide-react";
import { formatGen, shortAddress, shortId, timeAgo } from "@/lib/format";
import type { DaoSummary, Proposal } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import { Identicon } from "./Identicon";

export function DaoList({ daos, loading, error, selected, onSelect }: {
  daos?: DaoSummary[];
  loading: boolean;
  error: boolean;
  selected: string | null;
  onSelect: (address: string | null) => void;
}) {
  return (
    <section className="surface animate-rise p-4" aria-labelledby="dao-heading">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 id="dao-heading" className="text-sm font-semibold text-zinc-100">Monitored DAOs</h2>
        {selected ? (
          <button className="text-[11px] text-indigo-300 hover:underline" onClick={() => onSelect(null)}>Show all</button>
        ) : (
          <span className="text-[11px] text-zinc-600">{daos?.length ?? 0} watched</span>
        )}
      </div>
      {loading && <div className="h-20 animate-pulse rounded-xl bg-white/[0.04]" aria-busy />}
      {error && <p className="px-1 text-xs text-rose-300">Could not reach Studio Next. Retrying…</p>}
      <ul className="space-y-2">
        {daos?.map((dao) => {
                    const isSelected = selected === dao.key;
          return (
            <li key={dao.key}>
              <div
                role="button" tabIndex={0} aria-pressed={isSelected}
                onClick={() => onSelect(isSelected ? null : dao.key)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(isSelected ? null : dao.key))}
                className={`group cursor-pointer rounded-xl border p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 ${isSelected ? "border-indigo-400/40 bg-indigo-400/[0.07]" : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]"}`}
              >
                <div className="flex items-start gap-3">
                  <Identicon address={dao.address} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-0.5 font-mono text-[12px] text-zinc-200">
                      {shortAddress(dao.address, 8, 6)}<CopyButton value={dao.address} label="Copy timelock address" /><span className="ml-1 rounded bg-white/[0.06] px-1.5 text-[10px] text-zinc-400">chain {dao.chainId}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {dao.pool ? <>Pool <span className="font-mono text-zinc-300">{formatGen(dao.pool.stake)}</span> GEN</> : "Not registered"}
                    </div>
                  </div>
                  <span className={`badge ${dao.paused ? "badge-crit" : "badge-safe"}`}>
                    <span className="relative flex h-1.5 w-1.5">
                      {dao.paused && <span className="absolute inline-flex h-full w-full animate-pulseRing rounded-full bg-rose-400" />}
                      <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dao.paused ? "bg-rose-400" : "bg-emerald-400"}`} />
                    </span>
                    {dao.paused ? "Paused" : "Active"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.05] pt-2.5 text-center">
                  <Stat label="Committed" value={dao.committed.length} />
                  <Stat label="Flagged" value={dao.proposals.length} />
                  <Stat label="Frozen" value={dao.proposals.filter((p) => p.frozen).length} tone="text-rose-300" />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {daos?.length === 0 && !loading && <p className="px-1 text-xs text-zinc-500">No DAOs registered yet.</p>}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className={`font-mono text-sm tabular-nums ${value && tone ? tone : "text-zinc-200"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
    </div>
  );
}

interface LogEvent { key: string; at: number; kind: "flag" | "breaker"; proposal: Proposal }

export function ActivityLog({ proposals, onSelect }: { proposals: Proposal[]; onSelect: (p: Proposal) => void }) {
  const events: LogEvent[] = proposals.flatMap((p) => [
    { key: `f${p.id}`, at: p.proposedAt, kind: "flag" as const, proposal: p },
    ...(p.flaggedAt ? [{ key: `b${p.id}`, at: p.flaggedAt, kind: "breaker" as const, proposal: p }] : []),
  ]).sort((a, b) => b.at - a.at).slice(0, 8);
  return (
    <section className="surface animate-rise p-4" aria-labelledby="log-heading">
      <h2 id="log-heading" className="mb-3 px-1 text-sm font-semibold text-zinc-100">Activity log</h2>
      {events.length === 0 && <p className="px-1 text-xs text-zinc-500">No activity yet.</p>}
      <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-white/[0.06]">
        {events.map((e) => (
          <li key={e.key}>
            <button onClick={() => onSelect(e.proposal)} className="relative flex w-full items-start gap-3 rounded-lg px-1 py-1.5 text-left transition hover:bg-white/[0.04]">
              <span className={`z-10 grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border bg-zinc-900 ${e.kind === "breaker" ? "border-rose-500/40 text-rose-300" : "border-white/10 text-zinc-400"}`}>
                {e.kind === "breaker" ? <Siren size={13} /> : <Flag size={13} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-zinc-300">{e.kind === "breaker" ? "Circuit breaker tripped" : "Proposal flagged"} <span className="font-mono text-zinc-500">#{shortId(e.proposal.daoProposalId)}</span></span>
                <span className="block font-mono text-[10.5px] text-zinc-600">{timeAgo(e.at)} · {shortAddress(e.proposal.daoAddress, 6, 4)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
