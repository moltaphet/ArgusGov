"use client";

import { AlertTriangle, ExternalLink, Flag, Network, ShieldCheck, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChainGate } from "@/hooks/useChainGate";
import { CHALLENGE_BOND, useFlagProposal } from "@/hooks/useFlagProposal";
import { decodeActions } from "@/lib/decode";
import { formatGen, formatTokens, shortAddress } from "@/lib/format";
import type { CommittedProposal } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import { Identicon } from "./Identicon";
import { Spinner } from "./Spinner";
import { TxProgress } from "./TxProgress";

const keyOf = (c: Pick<CommittedProposal, "daoKey" | "daoProposalId">) => `${c.daoKey}#${c.daoProposalId}`;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Challenge a proposal the DAO has committed. The challenger picks one; its targets, values,
 * calldata and forum link are the DAO's own commitment and are shown read-only, so there is
 * nothing to paste and nothing to forge.
 */
export function FlagProposalModal({ open, onClose, committed, loading = false, preselect }: {
  open: boolean;
  onClose: () => void;
  committed: CommittedProposal[];
  loading?: boolean;
  preselect?: { daoKey: string; proposalId: number };
}) {
  const flag = useFlagProposal();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    }
    if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);

  // Open for challenge: never flagged, or judged safe once and not yet re-flagged. A live flag, a
  // standing freeze and a proposal that has used its re-flag are not.
  const openProposals = useMemo(() => committed.filter((c) => c.flaggable && !c.frozen), [committed]);
  useEffect(() => {
    if (preselect) setSelected(`${preselect.daoKey}#${preselect.proposalId}`);
  }, [preselect]);

  const chosen = openProposals.find((c) => keyOf(c) === selected);
  const actions = useMemo(() => (chosen ? decodeActions(chosen.targets, chosen.calldatas, chosen.values) : []), [chosen]);
  // The price is the contract's, per proposal: the base bond, or double for the one allowed re-flag.
  const bond = chosen && chosen.requiredBond > 0n ? chosen.requiredBond : CHALLENGE_BOND;
  const isReflag = Boolean(chosen && chosen.requiredBond > CHALLENGE_BOND);
  const gate = useChainGate(bond);

  const canSubmit = gate.ready && Boolean(chosen) && ack && !flag.busy;
  const blocker = !gate.isConnected ? "Connect a wallet to submit."
    : gate.wrongChain ? "Switch to GenLayer Studio Next to continue."
    : gate.insufficientFunds ? `Balance is below the ${formatGen(bond)} GEN bond.`
    : !chosen ? "Select a committed proposal to challenge."
    : !ack ? "Acknowledge the bond terms to continue." : "";

  async function submit() {
    if (!chosen) return;
    const ok = await flag.submit({ daoKey: chosen.daoKey, proposalId: chosen.daoProposalId, bond });
    if (ok) setTimeout(onClose, 1800);
  }

  return (
    <dialog ref={dialog} onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()} aria-labelledby="flag-title"
      className="m-auto w-[min(680px,94vw)] max-h-[92vh] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/70 p-0 text-zinc-200 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
      <div className="scroll max-h-[92vh] overflow-auto p-6">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 id="flag-title" className="text-base font-semibold text-zinc-100">Challenge a proposal</h2>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
              Choose a proposal its DAO has committed. The payload below is the DAO&apos;s own commitment, so you pick what to challenge and never supply the calldata.
            </p>
          </div>
          <button className="btn btn-quiet !p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="eyebrow mb-1.5">Committed proposals open for challenge</div>
            {loading && <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" aria-busy />}
            {!loading && openProposals.length === 0 && (
              <div className="surface-inset p-4 text-xs leading-relaxed text-zinc-400">
                No committed proposals are open for challenge. A proposal can be flagged only after its DAO&apos;s guardian or timelock commits it, and only once.
              </div>
            )}
            <div role="radiogroup" aria-label="Committed proposals" className="space-y-2">
              {openProposals.map((c) => {
                const on = keyOf(c) === selected;
                return (
                  <button key={keyOf(c)} type="button" role="radio" aria-checked={on} onClick={() => setSelected(keyOf(c))}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 ${on ? "border-indigo-400/50 bg-indigo-400/[0.08]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]"}`}>
                    <Identicon address={c.daoAddress} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-zinc-100">Proposal #{c.daoProposalId}</span>
                      <span className="block truncate font-mono text-[11px] text-zinc-500">{shortAddress(c.daoAddress, 8, 6)} · chain {c.chainId} · {hostOf(c.forumUrl)}</span>
                    </span>
                    {c.requiredBond > CHALLENGE_BOND && <span className="badge badge-warn font-mono">re-flag · {formatGen(c.requiredBond)} GEN</span>}
                    <span className="badge badge-mute font-mono">{c.targets.length} action{c.targets.length === 1 ? "" : "s"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {chosen && (
            <div className="surface-inset space-y-3 p-4" aria-label="Committed payload">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-300"><ShieldCheck size={13} className="text-emerald-300" /> Committed by the DAO, read-only</span>
                <a href={chosen.forumUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:underline">
                  {hostOf(chosen.forumUrl)} <ExternalLink size={10} />
                </a>
              </div>
              <ul className="space-y-1.5">
                {actions.map((a) => (
                  <li key={a.index} className="rounded-lg bg-black/25 px-3 py-2 text-[12px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-mute font-mono">{a.category.replace(/_/g, " ")}</span>
                      <span className="font-mono text-zinc-300">{a.signature}</span>
                      <span className="font-mono text-zinc-600">→ {shortAddress(a.target)}</span>
                    </div>
                    {a.details.map((d) => (
                      <div key={d.label} className="mt-1 flex gap-2 pl-1 font-mono text-[11px]">
                        <span className="text-zinc-600">{d.label}:</span>
                        <span className="break-all text-zinc-300">{d.label === "amount" && a.amountRaw !== undefined ? `${formatTokens(a.amountRaw)} tokens` : d.value}</span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-1 font-mono text-[11px] text-zinc-500">
                commitment {shortAddress(chosen.payloadHash, 10, 6)}<CopyButton value={chosen.payloadHash} label="Copy payload hash" />
              </div>
            </div>
          )}

          {gate.wrongChain && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs text-amber-100">
              <span className="flex items-center gap-2"><Network size={15} /> Your wallet is on the wrong network.</span>
              <button type="button" className="btn btn-glass !py-1.5" disabled={gate.isSwitching} onClick={() => void gate.switchToStudioNext()}>
                {gate.isSwitching ? <Spinner size={13} /> : null} Switch to GenLayer Studio Next
              </button>
            </div>
          )}

          <div className="surface-inset p-4">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">{isReflag ? "Re-flag bond (exact, 2x)" : "Challenge bond (exact)"}</span>
              <span className="figure text-xl font-semibold">{formatGen(bond)} GEN</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-zinc-500"><Wallet size={12} /> Wallet balance</span>
              <span className={`font-mono ${gate.insufficientFunds ? "text-rose-300" : "text-zinc-300"}`}>
                {!gate.isConnected ? "Not connected" : gate.balanceLoading ? "…" : gate.balance !== undefined ? `${formatGen(gate.balance, 3)} GEN` : "Unavailable"}
              </span>
            </div>
            {gate.insufficientFunds && <p role="alert" className="mt-2 text-[11px] text-rose-300">Insufficient balance: the bond alone needs {formatGen(bond)} GEN, before network fees.</p>}
            {isReflag && (
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-400" data-testid="reflag-note">
                Validators judged this proposal safe once. A proposal can be challenged one more time, at double the bond, and that is the last challenge it allows.
              </p>
            )}
            <div className="mt-3 flex gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs leading-relaxed text-amber-200/90">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span><strong className="font-semibold">{formatGen(bond)} GEN bond will be slashed if proposal is verified safe</strong> (half to the DAO, half burned) and you are locked out of flagging for 4 hours. If the breaker trips, the bond is returned with the bounty reserved at flag time after the 24h appeal window.</span>
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs text-zinc-300">
              <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-rose-500" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I understand I can lose this bond if validators judge the proposal safe.
            </label>
          </div>

          <TxProgress status={flag.status} error={flag.error} onRetry={flag.reset}
            labels={{ submit: `Submitting Bond (${formatGen(bond)} GEN)`, confirm: "Waiting for Block Confirmation", done: "Registered & Monitored" }} />

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-solid-rose" disabled={!canSubmit} onClick={submit}>
              {flag.busy ? <Spinner /> : <Flag size={14} />} {flag.busy ? "Working…" : `Post ${formatGen(bond)} GEN bond & flag`}
            </button>
            <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
            {blocker && !flag.busy && <span className="text-xs text-zinc-500" data-testid="submit-blocker">{blocker}</span>}
          </div>
        </div>
      </div>
    </dialog>
  );
}
