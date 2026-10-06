"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Eye, Flag } from "lucide-react";
import { useState } from "react";
import { formatGen } from "@/lib/format";
import { ARGUS_ADDRESS, EXPLORER_URL } from "@/lib/networks";
import { useDaos, useLedger } from "@/lib/queries";
import { DaoPanel } from "./DaoPanel";
import { FlagModal } from "./FlagModal";
import { ProposalInspector } from "./ProposalInspector";

export function Dashboard() {
  const [flagOpen, setFlagOpen] = useState(false);
  const { daos, proposals } = useDaos();
  const ledger = useLedger();

  return (
    <main className="mx-auto max-w-[1280px] px-5 pb-16 pt-6 sm:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[var(--blue)] to-[#bf5af2] shadow-lg shadow-blue-500/30">
            <Eye size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">ArgusGov</h1>
            <a className="mono text-[var(--faint)] hover:text-white" href={`${EXPLORER_URL}/address/${ARGUS_ADDRESS}`} target="_blank" rel="noreferrer">
              Studio Next · {ARGUS_ADDRESS.slice(0, 8)}…{ARGUS_ADDRESS.slice(-4)}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-danger" onClick={() => setFlagOpen(true)}><Flag size={16} /> Flag a proposal</button>
          <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Protocol ledger">
        <Tile label="Security pools" value={ledger.data ? `${formatGen(ledger.data.pool)} GEN` : "…"} />
        <Tile label="Bonds in escrow" value={ledger.data ? `${formatGen(ledger.data.escrow)} GEN` : "…"} />
        <Tile label="Claimable" value={ledger.data ? `${formatGen(ledger.data.claimable)} GEN` : "…"} />
        <Tile label="Burn vault" value={ledger.data ? `${formatGen(ledger.data.burnVault)} GEN` : "…"} />
        <Tile
          label="Solvency"
          value={ledger.data ? (ledger.data.solvent ? "Balanced" : "MISMATCH") : "…"}
          tone={ledger.data ? (ledger.data.solvent ? "var(--green)" : "var(--red)") : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <DaoPanel daos={daos.data} loading={daos.isLoading || proposals.isLoading} error={daos.isError || proposals.isError} />
        <ProposalInspector proposals={proposals.data} loading={proposals.isLoading} />
      </div>

      <FlagModal open={flagOpen} onClose={() => setFlagOpen(false)} knownDaos={(daos.data ?? []).map((d) => d.address)} />
    </main>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="glass !rounded-[22px] px-5 py-4 rise">
      <div className="text-xs font-medium text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color: tone }}>{value}</div>
    </div>
  );
}
