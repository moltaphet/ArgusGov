"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ChevronDown, Quote } from "lucide-react";
import { useEffect, useState } from "react";
import { loadConsensus } from "@/lib/consensus";
import { useVerdict } from "@/lib/queries";
import { EXPLORER_URL } from "@/lib/networks";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The leader validator's verdict, read from the consensus receipt and checked against the on-chain commitment. */
export function ReasoningTrace({ hash, onchainHash, daoKey, daoProposalId, scored }: {
  /** Inspection transaction, when this browser knows it; used for the explorer link only. */
  hash: string | undefined;
  onchainHash: string;
  daoKey: string;
  daoProposalId: number;
  scored: boolean;
}) {
  // The full reasoning text is stored on-chain and served by get_proposal_verdict.
  const verdict = useVerdict(daoKey, daoProposalId, scored);
  const receipt = useQuery({ queryKey: ["consensus", hash], enabled: Boolean(hash), queryFn: () => loadConsensus(hash!), staleTime: 5 * 60_000 });
  const reasoning = verdict.data?.reasoning || receipt.data?.reasoning;
  const [match, setMatch] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    setMatch(null);
    if (reasoning && onchainHash) sha256Hex(reasoning).then((h) => live && setMatch(h === onchainHash)).catch(() => undefined);
    return () => { live = false; };
  }, [reasoning, onchainHash]);

  return (
    <details open className="surface-inset group">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-medium text-zinc-300"><Quote size={14} className="text-zinc-500" /> Validator reasoning trace</span>
        <span className="flex items-center gap-3">
          {match === true && <span className="badge badge-safe"><BadgeCheck size={12} /> Matches on-chain hash</span>}
          {match === false && <span className="badge badge-warn">Hash differs from on-chain commitment</span>}
          <ChevronDown size={15} className="text-zinc-500 transition group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-white/[0.06] px-4 py-4">
        {!scored && <p className="text-xs leading-relaxed text-zinc-500">Validators have not scored this proposal yet. Their reasoning appears here once inspection completes.</p>}
        {scored && verdict.isLoading && <div className="space-y-2" aria-busy><div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" /><div className="h-3 w-5/6 animate-pulse rounded bg-white/[0.06]" /></div>}
        {scored && verdict.isError && <p className="text-xs text-amber-300">The verdict could not be loaded from Studio Next.</p>}
        {scored && !verdict.isLoading && !reasoning && !verdict.isError && (
          <p className="text-xs leading-relaxed text-zinc-500">This record predates on-chain reasoning storage; only its hash{onchainHash ? ` (${onchainHash.slice(0, 12)}…)` : ""} is available.</p>
        )}
        {reasoning && (
          <blockquote className="border-l-2 border-indigo-400/40 pl-4 text-[13px] leading-relaxed text-zinc-300">
            {reasoning}
            <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-600">
              <span>consensus verdict · score {verdict.data?.threatScore ?? receipt.data?.score}</span>
              {hash && <a className="text-indigo-300/80 hover:underline" href={`${EXPLORER_URL}/transactions/${hash}`} target="_blank" rel="noreferrer">view consensus receipt</a>}
            </footer>
          </blockquote>
        )}
      </div>
    </details>
  );
}
