"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Gavel, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { decodeActions, type DecodedAction } from "@/lib/decode";
import { countdown, formatGen, shortAddress, timeAgo } from "@/lib/format";
import { EXPLORER_URL, PROTOCOL } from "@/lib/networks";
import type { Proposal } from "@/lib/types";
import { StatusPill } from "./StatusPill";
import { ThreatGauge } from "./ThreatGauge";
import { PHASE_LABEL, useWrite } from "./useWrite";

const SEVERITY_COLOR = { critical: "var(--red)", high: "var(--amber)", info: "var(--blue)" } as const;

export function ProposalInspector({ proposals, loading }: { proposals?: Proposal[]; loading: boolean }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const ordered = useMemo(() => [...(proposals ?? [])].sort((a, b) => b.id - a.id), [proposals]);
  useEffect(() => {
    if (selectedId === null && ordered.length > 0) setSelectedId(ordered[0].id);
  }, [ordered, selectedId]);
  const selected = ordered.find((p) => p.id === selectedId);

  return (
    <section className="glass p-6 rise" aria-labelledby="inspector-heading">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="inspector-heading" className="text-lg font-semibold">Live Proposal Inspector</h2>
        <span className="text-xs text-[var(--faint)]">{ordered.length} flagged</span>
      </div>
      {loading && <div className="glass-inner h-64 animate-pulse" />}
      {!loading && ordered.length === 0 && (
        <div className="glass-inner p-8 text-center text-sm text-[var(--muted)]">
          No proposals have been flagged yet. Use “Flag a proposal” to challenge one.
        </div>
      )}
      {ordered.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <ul className="scroll flex max-h-[560px] gap-2 overflow-auto lg:flex-col" role="listbox" aria-label="Flagged proposals">
            {ordered.map((p) => (
              <li key={p.id} className="shrink-0 lg:shrink">
                <button
                  role="option"
                  aria-selected={p.id === selectedId}
                  onClick={() => setSelectedId(p.id)}
                  className={`glass-inner w-44 p-3 text-left transition lg:w-full ${p.id === selectedId ? "!border-[var(--blue)] bg-white/10" : "hover:bg-white/10"}`}
                >
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span>Proposal #{p.daoProposalId}</span>
                    <span className="tabular-nums text-xs text-[var(--faint)]">#{p.id}</span>
                  </div>
                  <div className="mono mt-0.5 text-[var(--faint)]">{shortAddress(p.daoAddress)}</div>
                  <div className="mt-2"><StatusPill status={p.status} /></div>
                </button>
              </li>
            ))}
          </ul>
          {selected && <ProposalDetail key={selected.id} proposal={selected} />}
        </div>
      )}
    </section>
  );
}

function useForumText(url: string) {
  return useQuery({
    queryKey: ["forum", url],
    staleTime: 60_000,
    queryFn: async (): Promise<{ available: boolean; text: string; error?: string }> => {
      const res = await fetch(`/api/forum?url=${encodeURIComponent(url)}`);
      return res.json();
    },
  });
}

function ProposalDetail({ proposal: p }: { proposal: Proposal }) {
  const forum = useForumText(p.forumUrl);
  const actions = useMemo(() => decodeActions(p.targets, p.calldatas), [p.targets, p.calldatas]);
  const write = useWrite();
  const scored = p.status !== "REGISTERED";
  const now = Date.now() / 1000;
  const appealLeft = p.flaggedAt ? p.flaggedAt + PROTOCOL.appealWindowSeconds - now : 0;
  const critical = actions.filter((a) => a.severity === "critical").length;

  return (
    <div className="space-y-4">
      <div className="glass-inner flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={p.status} />
          {p.frozen && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--red)]/15 px-2.5 py-1 text-[11px] font-semibold text-[var(--red)]">
              <AlertTriangle size={12} /> Execution frozen
            </span>
          )}
          {p.resolution && <span className="text-xs text-[var(--muted)]">{p.resolution.replace("_", " ").toLowerCase()}</span>}
        </div>
        <div className="text-xs text-[var(--faint)]">Flagged {timeAgo(p.proposedAt)} by <span className="mono">{shortAddress(p.challenger)}</span></div>
      </div>

      <div className="grid gap-4 md:grid-cols-[250px_1fr]">
        <div className="glass-inner flex flex-col items-center justify-center p-4">
          <div className="label mb-3 self-start">Discrepancy score</div>
          <ThreatGauge score={p.threatScore} pending={!scored} />
          {scored && p.reasoningHash && (
            <div className="mono mt-4 w-full truncate text-center text-[var(--faint)]" title={p.reasoningHash}>
              reasoning {p.reasoningHash.slice(0, 10)}…
            </div>
          )}
        </div>

        <div className="glass-inner p-4">
          <div className="label mb-2 flex items-center justify-between">
            <span>Forum intent</span>
            <a href={p.forumUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--blue)] hover:underline">
              {new URL(p.forumUrl).hostname} <ExternalLink size={11} />
            </a>
          </div>
          {forum.isLoading && <div className="h-20 animate-pulse rounded-xl bg-white/5" />}
          {forum.data?.available ? (
            <p className="scroll max-h-40 overflow-auto text-sm leading-relaxed text-[var(--muted)]">{forum.data.text}</p>
          ) : (
            !forum.isLoading && (
              <p className="text-sm text-[var(--amber)]">
                The post could not be read{forum.data?.error ? ` (${forum.data.error})` : ""}. Validators treat an unreadable post as
                <em> no declared intent</em>: every privileged call is then undisclosed.
              </p>
            )
          )}
        </div>
      </div>

      <div>
        <div className="label mb-2 flex items-center justify-between">
          <span>Executed calldata, decoded ({actions.length} action{actions.length === 1 ? "" : "s"})</span>
          {critical > 0 && <span className="text-[var(--red)]">{critical} critical</span>}
        </div>
        <ul className="space-y-2">
          {actions.map((a) => <ActionCard key={a.index} action={a} />)}
        </ul>
      </div>

      <dl className="glass-inner grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-xs md:grid-cols-4">
        <Fact label="Challenger bond" value={`${formatGen(p.challengerBond)} GEN`} />
        <Fact label="Reward at stake" value={p.rewardAmount ? `${formatGen(p.rewardAmount)} GEN` : "n/a"} />
        <Fact label="Appeal window" value={p.status === "FLAGGED_MALICIOUS" ? countdown(appealLeft) : p.appealBond ? "appealed" : "n/a"} />
        <Fact label="Payload hash" value={p.payloadHash ? `${p.payloadHash.slice(0, 10)}…` : "n/a"} mono />
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        {p.status === "REGISTERED" && (
          <button className="btn btn-primary" disabled={write.busy} onClick={() => write.run("inspect_proposal", [BigInt(p.id)])}>
            <Search size={16} /> Run validator inspection
          </button>
        )}
        {p.status === "ANALYZING" && (
          <button className="btn btn-danger" disabled={write.busy} onClick={() => write.run("execute_circuit_breaker", [BigInt(p.id)])}>
            <Gavel size={16} /> Execute circuit breaker
          </button>
        )}
        <a className="btn btn-ghost" href={`${EXPLORER_URL}/address/${p.daoAddress}`} target="_blank" rel="noreferrer">
          DAO on explorer <ExternalLink size={14} />
        </a>
        <WriteStatus state={write.state} />
      </div>
    </div>
  );
}

function ActionCard({ action: a }: { action: DecodedAction }) {
  const color = SEVERITY_COLOR[a.severity];
  return (
    <li className="glass-inner p-3.5" style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
            {a.category.replace(/_/g, " ")}
          </span>
          <span className="mono text-[var(--muted)]">{a.signature}</span>
        </div>
        <span className="mono text-[var(--faint)]">→ {shortAddress(a.target)}</span>
      </div>
      {a.details.length > 0 && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
          {a.details.map((d) => (
            <div key={d.label} className="contents">
              <dt className="text-[var(--faint)]">{d.label}</dt>
              <dd className="mono break-all text-[var(--text)]">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[var(--faint)]">{label}</dt>
      <dd className={`mt-0.5 font-semibold ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}

export function WriteStatus({ state }: { state: ReturnType<typeof useWrite>["state"] }) {
  if (state.phase === "idle") return null;
  if (state.phase === "error") return <span role="alert" className="text-xs text-[var(--red)]">{state.message}</span>;
  const done = state.phase === "decided";
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-xs ${done ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
      {!done && <span className="h-2 w-2 rounded-full bg-[var(--blue)] breathe" />}
      {PHASE_LABEL[state.phase]}
      {"hash" in state && state.hash && (
        <a className="mono text-[var(--blue)] hover:underline" href={`${EXPLORER_URL}/transactions/${state.hash}`} target="_blank" rel="noreferrer">
          {shortAddress(state.hash, 8, 4)}
        </a>
      )}
    </span>
  );
}
