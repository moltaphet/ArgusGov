"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import { shortAddress } from "@/lib/format";
import { ARGUS_ADDRESS, EXPLORER_URL } from "@/lib/networks";
import { useLedger } from "@/lib/queries";

// The repository is configurable; without it the GitHub link falls back to the
// maintainer profile and the test-suite badge stays a plain label.
const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL;
const GITHUB_URL = REPO_URL ?? "https://github.com/moltaphet";

function NetworkPill() {
  const ledger = useLedger();
  const state = ledger.data ? (ledger.data.solvent ? "ok" : "bad") : ledger.isError ? "bad" : "wait";
  const tone = { ok: "badge-safe", bad: "badge-crit", wait: "badge-mute" }[state];
  const dot = { ok: "bg-emerald-400", bad: "bg-rose-400", wait: "bg-zinc-500" }[state];
  const text = { ok: "Solvent", bad: ledger.isError ? "Chain unreachable" : "Ledger mismatch", wait: "Reading chain" }[state];
  return (
    <span className={`badge ${tone}`} role="status">
      <span className="relative flex h-1.5 w-1.5">
        {state !== "wait" && <span className={`absolute inline-flex h-full w-full animate-pulseRing rounded-full ${dot}`} />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot}`} />
      </span>
      GenLayer Studio Next (61997) • {text}
    </span>
  );
}

function FooterLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  return (
    <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex items-center gap-1 text-[13px] text-zinc-400 transition hover:text-zinc-100">
      {children}{external && <ExternalLink size={11} className="text-zinc-600" />}
    </a>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-white/[0.07] bg-black/20 backdrop-blur-2xl">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.1] to-white/[0.02] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                <ShieldCheck size={17} />
              </div>
              <div className="leading-tight">
                <div className="text-[15px] font-semibold tracking-tight text-zinc-100">ArgusGov</div>
                <div className="text-xs text-zinc-500">Autonomous DAO Circuit Breaker</div>
              </div>
            </div>
            <div className="mt-5"><NetworkPill /></div>
          </div>

          <div>
            <h4 className="eyebrow">Deployed contract</h4>
            <a href={`${EXPLORER_URL}/address/${ARGUS_ADDRESS}`} target="_blank" rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-[13px] text-indigo-300 hover:underline">
              {shortAddress(ARGUS_ADDRESS, 10, 4)} <ExternalLink size={11} />
            </a>
            <p className="mt-1.5 text-xs text-zinc-600">GenLayer Studio Next Explorer</p>
          </div>

          <nav aria-label="Protocol links">
            <h4 className="eyebrow">Protocol</h4>
            <ul className="mt-3 space-y-2">
              <li><FooterLink href="#invariants">Protocol Invariants</FooterLink></li>
              <li>
                {REPO_URL
                  ? <FooterLink href={`${REPO_URL}/tree/main/tests`} external>Test Suite (147 Passed)</FooterLink>
                  : <span className="text-[13px] text-zinc-400">Test Suite (147 Passed)</span>}
              </li>
              <li><FooterLink href={GITHUB_URL} external>GitHub</FooterLink></li>
              <li><FooterLink href="https://docs.genlayer.com" external>GenLayer Docs</FooterLink></li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 border-t border-white/[0.06] pt-6 text-[11.5px] leading-relaxed text-zinc-600">
          <p>
            <strong className="font-medium text-zinc-500">Security notice.</strong> ArgusGov is an unaudited testnet prototype. Verdicts come from LLM validators
            and can be wrong in either direction; a &quot;safe&quot; result is not an endorsement of a proposal. Nothing here is financial,
            legal or security advice, and test-network tokens have no monetary value. Review the contract and its invariants before relying on it.
          </p>
          <p className="mt-2">&copy; 2026 ArgusGov. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
