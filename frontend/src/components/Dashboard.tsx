"use client";

import { Eye, Flag } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ARGUS_ADDRESS, EXPLORER_URL } from "@/lib/networks";
import { useDaos, useLedger } from "@/lib/queries";
import { shortAddress } from "@/lib/format";
import { AboutSection } from "./AboutSection";
import { ConnectPill } from "./ConnectPill";
import { ActivityLog, DaoList } from "./DaoRail";
import { FAQSection } from "./FAQSection";
import { FlagProposalModal } from "./FlagProposalModal";
import { Footer } from "./Footer";
import { LiveProposalInspector } from "./LiveProposalInspector";
import { MetricCards } from "./MetricCards";

export function Dashboard() {
  const [flagOpen, setFlagOpen] = useState(false);
  const [daoFilter, setDaoFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { daos, proposals } = useDaos();
  const ledger = useLedger();

  const visible = useMemo(() => {
    const all = [...(proposals.data ?? [])].sort((a, b) => b.id - a.id);
    return daoFilter ? all.filter((p) => p.daoAddress.toLowerCase() === daoFilter) : all;
  }, [proposals.data, daoFilter]);
  const onSelect = useCallback((id: number) => setSelectedId(id), []);

  return (
    <>
    <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.1] to-white/[0.02] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <Eye size={17} />
          </div>
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">ArgusGov</h1>
            <a className="font-mono text-[11px] text-zinc-500 hover:text-zinc-300" href={`${EXPLORER_URL}/address/${ARGUS_ADDRESS}`} target="_blank" rel="noreferrer">
              Studio Next · {shortAddress(ARGUS_ADDRESS, 8, 4)}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button className="btn btn-outline-rose" onClick={() => setFlagOpen(true)}><Flag size={14} /> Flag a proposal</button>
          <ConnectPill />
        </div>
      </header>

      <section className="relative mb-9 pt-4" aria-labelledby="hero-heading">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[min(900px,100%)] -translate-x-1/2 rounded-full bg-indigo-500/[0.10] blur-3xl" />
        <span className="relative inline-flex items-center gap-2 rounded-full border border-indigo-300/25 bg-indigo-400/[0.08] px-3.5 py-1.5 font-mono text-[10.5px] font-medium tracking-[0.14em] text-indigo-200 shadow-[0_0_28px_rgba(129,140,248,0.22)]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-pulseRing rounded-full bg-indigo-300" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-300" />
          </span>
          GENLAYER STUDIO NEXT • TESTNET PROTOCOL
        </span>
        <h2 id="hero-heading" className="relative mt-5 bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
          Autonomous Timelock Sentinel
        </h2>
        <p className="relative mt-4 max-w-2xl text-base leading-relaxed tracking-tight text-zinc-300">
          Validators read what a proposal promises, decode what its calldata executes, and freeze execution the moment the two disagree.
        </p>
      </section>

      <main className="space-y-5">
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute -inset-x-10 -inset-y-6 -z-10 rounded-[3rem] bg-indigo-500/[0.07] blur-3xl" />
          <MetricCards ledger={ledger.data} daos={daos.data} proposals={proposals.data} loading={ledger.isLoading || proposals.isLoading} />
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-5">
            <DaoList daos={daos.data} loading={daos.isLoading || proposals.isLoading} error={daos.isError || proposals.isError}
              selected={daoFilter} onSelect={(a) => { setDaoFilter(a); setSelectedId(null); }} />
            <ActivityLog proposals={proposals.data ?? []} onSelect={(p) => { setDaoFilter(null); setSelectedId(p.id); }} />
          </div>
          <LiveProposalInspector proposals={visible} selectedId={selectedId} onSelect={onSelect} loading={proposals.isLoading} />
        </div>
      </main>

      <AboutSection />
      <FAQSection />

      <FlagProposalModal open={flagOpen} onClose={() => setFlagOpen(false)} knownDaos={(daos.data ?? []).map((d) => d.address)} />
    </div>
    <Footer />
    </>
  );
}
