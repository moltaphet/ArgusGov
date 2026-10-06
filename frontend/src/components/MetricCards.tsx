"use client";

import { Coins, Lock, ShieldCheck, ShieldAlert, Vault } from "lucide-react";
import { formatGen } from "@/lib/format";
import { computeImpact } from "@/lib/impact";
import type { DaoSummary, Ledger, Proposal } from "@/lib/types";

type Tint = "emerald" | "indigo" | "gold" | "rose";
const TINTS: Record<Tint, { wash: string; edge: string; icon: string }> = {
  emerald: { wash: "from-emerald-400/[0.10]", edge: "via-emerald-400/60", icon: "text-emerald-300" },
  indigo: { wash: "from-indigo-400/[0.10]", edge: "via-indigo-400/60", icon: "text-indigo-300" },
  gold: { wash: "from-amber-300/[0.10]", edge: "via-amber-300/60", icon: "text-amber-200" },
  rose: { wash: "from-rose-500/[0.14]", edge: "via-rose-400/70", icon: "text-rose-300" },
};

function Card({ icon, title, tint, children, foot }: { icon: React.ReactNode; title: string; tint: Tint; children: React.ReactNode; foot?: React.ReactNode }) {
  const t = TINTS[tint];
  return (
    <div className="surface group relative animate-rise flex flex-col justify-between overflow-hidden p-5 transition-all duration-300 hover:border-white/[0.16]">
      <div aria-hidden className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.wash} via-transparent to-transparent`} />
      <div aria-hidden className={`pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent ${t.edge} to-transparent`} />
      <div className="relative flex items-center justify-between">
        <span className="eyebrow">{title}</span>
        <span className={`relative grid h-7 w-7 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.04] ${t.icon}`}>{icon}</span>
      </div>
      <div className="relative mt-3">{children}</div>
      {foot && <div className="relative mt-3 text-[11px] text-zinc-500">{foot}</div>}
    </div>
  );
}

function Amount({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-2xl font-bold leading-none tracking-tighter text-white tabular-nums">{value}</span>
      <span className="font-mono text-xs text-zinc-500">{unit}</span>
    </div>
  );
}

export function MetricCards({ ledger, daos, proposals, loading }: {
  ledger?: Ledger & { solvent: boolean };
  daos?: DaoSummary[];
  proposals?: Proposal[];
  loading: boolean;
}) {
  const impact = computeImpact(proposals ?? []);
  const pending = (proposals ?? []).filter((p) => ["REGISTERED", "ANALYZING"].includes(p.status)).length;
  const frozen = (proposals ?? []).filter((p) => p.frozen).length;
  const na = "—";

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="System health">
      <Card icon={<Vault size={14} />} title="DAO security pool" tint="emerald"
        foot={<>Across {daos?.length ?? 0} registered DAO{daos?.length === 1 ? "" : "s"}</>}>
        <Amount value={ledger ? formatGen(ledger.pool) : na} unit="GEN" />
        <div className="mt-2.5">
          {ledger ? (
            ledger.solvent
              ? <span className="badge badge-safe"><ShieldCheck size={11} /> Solvent &amp; Active</span>
              : <span className="badge badge-crit"><ShieldAlert size={11} /> Ledger mismatch</span>
          ) : <span className="badge badge-mute">{loading ? "Reading chain…" : "Unavailable"}</span>}
        </div>
      </Card>

      <Card icon={<Lock size={14} />} title="Escrowed challenger bonds" tint="indigo"
        foot={<span title="Includes bounties reserved for challengers while the 24h appeal window runs">{pending} awaiting inspection or settlement</span>}>
        <Amount value={ledger ? formatGen(ledger.escrow) : na} unit="GEN" />
        <div className="mt-2.5 text-[11px] text-zinc-500">Locked until verdict or appeal window closes</div>
      </Card>

      <Card icon={<Coins size={14} />} title="Protected value" tint="gold"
        foot={<>{impact.drainsThwarted} drain{impact.drainsThwarted === 1 ? "" : "s"} thwarted{impact.unlimitedApprovals ? ` · ${impact.unlimitedApprovals} unlimited approval${impact.unlimitedApprovals === 1 ? "" : "s"}` : ""}</>}>
        <Amount value={proposals ? impact.tokensProtected.toLocaleString("en-US") : na} unit="tokens" />
        <div className="mt-2.5 text-[11px] text-zinc-500" title="Sum of transfers, mints and withdrawals in frozen proposals; 18 decimals assumed">Held back by frozen proposals</div>
      </Card>

      <Card icon={frozen ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />} title="Circuit breaker" tint={frozen ? "rose" : "emerald"}
        foot={frozen ? `${frozen} proposal${frozen === 1 ? "" : "s"} frozen from execution` : "No proposal is frozen"}>
        {!proposals ? <span className="text-sm text-zinc-500">{loading ? "Reading chain…" : "Unavailable"}</span> : (
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className={`absolute inline-flex h-full w-full animate-pulseRing rounded-full ${frozen ? "bg-rose-500" : "bg-emerald-400"}`} />
              <span className={`relative inline-flex h-3 w-3 rounded-full ${frozen ? "bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.9)]" : "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]"}`} />
            </span>
            <span className={`text-xl font-bold tracking-tight ${frozen ? "text-rose-300" : "text-emerald-300"}`}>
              {frozen ? "Emergency pause active" : "Guarding"}
            </span>
          </div>
        )}
      </Card>
    </section>
  );
}
