"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Coins, Gavel, Scale, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { useAppealFlag } from "@/hooks/useAppealFlag";
import { useClaimReward } from "@/hooks/useClaimReward";
import { useExecuteCircuitBreaker, useInspectProposal } from "@/hooks/useInspectProposal";
import { decodeActions } from "@/lib/decode";
import { availableActions, type ActionId } from "@/lib/lifecycle";
import { readView } from "@/lib/genlayer";
import { countdown, formatGen, shortAddress, timeAgo } from "@/lib/format";
import { inspectHashFor, loadConsensus } from "@/lib/consensus";
import { EXPLORER_URL, PROTOCOL } from "@/lib/networks";
import type { Proposal } from "@/lib/types";
import { CalldataTerminal, DeclaredIntentCard } from "./AuditDiff";
import { CopyButton } from "./CopyButton";
import { Identicon } from "./Identicon";
import { ReasoningTrace } from "./ReasoningTrace";
import { Spinner } from "./Spinner";
import { StatusBadge } from "./StatusBadge";
import { ThreatGauge } from "./ThreatGauge";

function useForum(url: string) {
  return useQuery({
    queryKey: ["forum", url],
    staleTime: 60_000,
    queryFn: async (): Promise<{ available: boolean; text: string; error?: string }> =>
      (await fetch(`/api/forum?url=${encodeURIComponent(url)}`)).json(),
  });
}

export function LiveProposalInspector({ proposals, selectedId, onSelect, loading }: {
  proposals: Proposal[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
}) {
  const selected = proposals.find((p) => p.id === selectedId) ?? proposals[0];
  useEffect(() => {
    if (selected && selected.id !== selectedId) onSelect(selected.id);
  }, [selected, selectedId, onSelect]);

  return (
    <section className="surface animate-rise" aria-labelledby="inspector-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border-b border-white/[0.06] px-5 py-3.5">
        <h2 id="inspector-heading" className="text-sm font-semibold text-zinc-100">Live proposal inspector</h2>
        {proposals.length > 1 && (
          <div className="scroll flex max-w-full gap-1.5 overflow-x-auto" role="tablist" aria-label="Flagged proposals">
            {proposals.map((p) => (
              <button key={p.id} role="tab" aria-selected={p.id === selected?.id} onClick={() => onSelect(p.id)}
                className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-xs transition ${p.id === selected?.id ? "bg-white/[0.1] text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`}>
                #{p.daoProposalId}
              </button>
            ))}
          </div>
        )}
      </div>
      {loading && <div className="space-y-3 p-6" aria-busy><div className="h-10 animate-pulse rounded-xl bg-white/[0.05]" /><div className="h-64 animate-pulse rounded-xl bg-white/[0.04]" /></div>}
      {!loading && !selected && (
        <div className="grid place-items-center px-6 py-20 text-center">
          <ShieldCheck size={30} className="mb-3 text-zinc-600" />
          <p className="text-sm font-medium text-zinc-300">No flagged proposals</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">When a challenger flags a proposal for this selection, its declared intent and decoded calldata appear here side by side.</p>
        </div>
      )}
      {selected && <Detail key={selected.id} p={selected} />}
    </section>
  );
}

function Detail({ p }: { p: Proposal }) {
  const forum = useForum(p.forumUrl);
  const actions = useMemo(() => decodeActions(p.targets, p.calldatas), [p.targets, p.calldatas]);
  const inspectHash = typeof window === "undefined" ? undefined : inspectHashFor(p.id);
  const consensus = useQuery({ queryKey: ["consensus", inspectHash], enabled: Boolean(inspectHash), queryFn: () => loadConsensus(inspectHash!), staleTime: 5 * 60_000 });
  const now = Date.now() / 1000;
  const { address } = useAccount();
  const pool = useQuery({ queryKey: ["daos", "pool", p.daoAddress], staleTime: 30_000, queryFn: () => readView<{ guardian?: string }>("get_security_pool", [p.daoAddress]) });
  const inspect = useInspectProposal();
  const settle = useExecuteCircuitBreaker();
  const appeal = useAppealFlag();
  const claim = useClaimReward();
  const anyBusy = inspect.busy || settle.busy || appeal.busy || claim.busy;
  const actionList = availableActions(p, { account: address?.toLowerCase(), guardian: pool.data?.guardian?.toLowerCase(), now });
  const scored = p.status !== "REGISTERED";
  const appealLeft = p.flaggedAt ? p.flaggedAt + PROTOCOL.appealWindowSeconds - now : 0;
  const verdictTime = p.flaggedAt || p.proposedAt;
  const critical = scored && p.threatScore >= PROTOCOL.threatThreshold;
  const verdictDate = consensus.data?.createdAt ? new Date(consensus.data.createdAt) : new Date(verdictTime * 1000);

  const handlers: Record<ActionId, () => Promise<boolean>> = {
    inspect: () => inspect.inspect(p.id, p.status),
    settle: () => settle.execute(p.id),
    appeal: () => appeal.appeal(p),
    claim: () => claim.claim(p.id),
  };
  const busyFor: Record<ActionId, boolean> = { inspect: inspect.busy, settle: settle.busy, appeal: appeal.busy, claim: claim.busy };
  const iconFor: Record<ActionId, React.ReactNode> = { inspect: <Search size={15} />, settle: <Gavel size={15} />, appeal: <Scale size={15} />, claim: <Coins size={15} /> };
  const toneFor: Record<ActionId, string> = { inspect: "btn-glass", settle: "btn-solid-rose", appeal: "btn-glass", claim: "btn-glass" };

  return (
    <div className="space-y-4 p-5">
      {/* Command bar */}
      <div className="surface-inset flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Identicon address={p.daoAddress} size={34} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-100">Proposal #{p.daoProposalId}</span>
              <span className="font-mono text-[11px] text-zinc-600">record {p.id}</span>
            </div>
            <div className="flex items-center gap-1 font-mono text-[11px] text-zinc-500">
              {shortAddress(p.daoAddress, 8, 6)}<CopyButton value={p.daoAddress} label="Copy DAO address" />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={p.status} />
          {p.frozen && <span className="badge badge-crit"><AlertTriangle size={11} /> Execution frozen</span>}
          {consensus.data ? (
            <span className={`badge ${consensus.data.verified ? "badge-safe" : "badge-warn"}`}>
              <CheckCircle2 size={11} /> {consensus.data.agree}/{consensus.data.total} {consensus.data.verified ? "Majority consensus verified" : "No majority"}
            </span>
          ) : scored ? (
            <span className="badge badge-mute" title="The consensus receipt for this proposal is not linked in this browser">Quorum record unavailable</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
          <Clock size={12} />
          {scored ? `Consensus ${verdictDate.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : `Flagged ${timeAgo(p.proposedAt)}`}
        </div>
      </div>

      {/* Gauge + verdict facts */}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="relative">
          {critical && (
            <div aria-hidden className="pointer-events-none absolute -inset-x-14 -inset-y-12 rounded-full bg-rose-600/30 opacity-20 blur-3xl" />
          )}
          <div className={`surface-inset relative flex h-full items-center justify-center px-4 py-6 transition-all duration-500 ${critical ? "!border-rose-500/40 shadow-[0_0_40px_rgba(244,63,94,0.12)]" : ""}`}>
            <ThreatGauge score={p.threatScore} pending={!scored} />
          </div>
        </div>
        <dl className="surface-inset grid grid-cols-2 content-center gap-x-6 gap-y-5 p-5 sm:grid-cols-3">
          <Fact label="Challenger" value={shortAddress(p.challenger, 6, 4)} mono />
          <Fact label="Bond" value={`${formatGen(p.challengerBond)} GEN`} />
          <Fact label="Reward at stake" value={p.rewardAmount ? `${formatGen(p.rewardAmount)} GEN` : "n/a"} />
          <Fact label="Appeal window" value={p.status === "FLAGGED_MALICIOUS" ? countdown(appealLeft) : p.appealBond ? "Appealed" : "n/a"} />
          <Fact label="Actions" value={String(actions.length)} />
          <Fact label="Reasoning hash" value={p.reasoningHash ? `${p.reasoningHash.slice(0, 10)}…` : "n/a"} mono />
        </dl>
      </div>

      {/* Side-by-side audit */}
      <div className="grid gap-4 xl:grid-cols-2">
        <DeclaredIntentCard url={p.forumUrl} forum={{ loading: forum.isLoading, available: Boolean(forum.data?.available), text: forum.data?.text ?? "", error: forum.data?.error }} />
        <CalldataTerminal actions={actions} forumText={forum.data?.text ?? ""} />
      </div>

      <ReasoningTrace hash={inspectHash} onchainHash={p.reasoningHash} />

      <div className="flex flex-wrap items-start gap-2.5">
        {actionList.map((a) => (
          <div key={a.id} className="flex flex-col gap-1">
            <button type="button" className={`btn ${toneFor[a.id]}`} disabled={!a.enabled || anyBusy} title={a.reason}
              onClick={() => void handlers[a.id]()}>
              {busyFor[a.id] ? <Spinner /> : iconFor[a.id]} {a.label}
            </button>
            {!a.enabled && a.reason && <span className="max-w-[210px] text-[11px] leading-snug text-zinc-500">{a.reason}</span>}
          </div>
        ))}
        <a className="btn btn-quiet" href={`${EXPLORER_URL}/address/${p.daoAddress}`} target="_blank" rel="noreferrer">View DAO on explorer</a>
      </div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-1 text-sm text-zinc-100 ${mono ? "font-mono text-[13px]" : "font-medium"}`}>{value}</dd>
    </div>
  );
}
