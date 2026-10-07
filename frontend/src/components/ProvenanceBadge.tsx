"use client";

import { BadgeCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { shortAddress } from "@/lib/format";
import { provenanceView } from "@/lib/provenance";
import type { CommittedProposal } from "@/lib/types";
import { CopyButton } from "./CopyButton";

const TONE = {
  safe: { badge: "badge-safe", border: "border-emerald-400/25", icon: <BadgeCheck size={13} /> },
  warn: { badge: "badge-warn", border: "border-amber-400/20", icon: <ShieldQuestion size={13} /> },
  crit: { badge: "badge-crit", border: "border-rose-400/30", icon: <ShieldAlert size={13} /> },
} as const;

/** "Provenance Status": proof that a proposal came from a real Governor on its origin chain. */
export function ProvenanceBadge({ committed }: { committed: CommittedProposal | undefined }) {
  if (!committed) {
    return (
      <section className="surface-inset px-4 py-3" aria-label="Provenance status">
        <span className="eyebrow">Provenance status</span>
        <p className="mt-1 text-xs text-zinc-500">No commitment found for this proposal.</p>
      </section>
    );
  }
  const v = provenanceView(committed);
  const t = TONE[v.tone];
  const verified = v.status === "VERIFIED";
  return (
    <section className={`surface-inset border ${t.border} px-4 py-3`} aria-label="Provenance status" data-provenance={v.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">Provenance status</span>
        <span className={`badge ${t.badge}`}>{t.icon} {v.headline}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{v.detail}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <div>
          <dt className="eyebrow">Origin Governor</dt>
          <dd className="mt-1 flex items-center gap-1 font-mono text-[12px] text-zinc-100">
            {verified && v.governor ? <>{shortAddress(v.governor, 8, 6)}<CopyButton value={v.governor} label="Copy Governor address" /></> : "n/a"}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Target chain ID</dt>
          <dd className="mt-1 font-mono text-[12px] text-zinc-100">{v.chainId}</dd>
        </div>
        <div>
          <dt className="eyebrow">descriptionHash</dt>
          <dd className="mt-1 flex items-center gap-1 font-mono text-[12px] text-zinc-100">
            {v.descriptionHash ? <>{v.descriptionHash.slice(0, 10)}…{v.descriptionHash.slice(-6)}<CopyButton value={v.descriptionHash} label="Copy description hash" />
              {v.idMatches !== null && (
                <span className={`badge ml-1 ${v.idMatches ? "badge-safe" : "badge-crit"}`}>{v.idMatches ? "id matches" : "id MISMATCH"}</span>
              )}</> : "n/a"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-zinc-600">
        proposalId = keccak256(abi.encode(targets, values, calldatas, descriptionHash))
      </p>
    </section>
  );
}
