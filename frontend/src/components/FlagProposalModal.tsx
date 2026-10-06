"use client";

import { AlertTriangle, Flag, Network, Plus, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeAction } from "@/lib/decode";
import { formatGen } from "@/lib/format";
import { useChainGate } from "@/hooks/useChainGate";
import { CHALLENGE_BOND, useFlagProposal } from "@/hooks/useFlagProposal";
import { MONITORED_DAOS, PROTOCOL } from "@/lib/networks";
import { Spinner } from "./Spinner";
import { TxProgress } from "./TxProgress";

interface Row { target: string; calldata: string }
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x([0-9a-fA-F]{2})*$/;

function validUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && value.length <= 512;
  } catch {
    return false;
  }
}

export function FlagProposalModal({ open, onClose, knownDaos }: { open: boolean; onClose: () => void; knownDaos: string[] }) {
  const gate = useChainGate(CHALLENGE_BOND);
  const flag = useFlagProposal();
  const dialog = useRef<HTMLDialogElement>(null);
  const [dao, setDao] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [forumUrl, setForumUrl] = useState("");
  const [rows, setRows] = useState<Row[]>([{ target: "", calldata: "" }]);
  const [ack, setAck] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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

  const daoOptions = useMemo(() => Array.from(new Set([...knownDaos, ...MONITORED_DAOS])), [knownDaos]);
  const bond = CHALLENGE_BOND;

  const fieldErrors = {
    dao: ADDR.test(dao) ? "" : "Enter the DAO timelock address (0x + 40 hex characters).",
    proposalId: /^\d+$/.test(proposalId) ? "" : "Use a non-negative whole number.",
    forumUrl: validUrl(forumUrl) ? "" : "Enter a public http(s) link to the forum post.",
  };
  const rowErrors = rows.map((r) => ({
    target: ADDR.test(r.target) ? "" : "Target must be a 0x address.",
    calldata: r.calldata.trim() !== "" && HEX.test(r.calldata.trim()) ? "" : "Calldata must be even-length 0x hex.",
  }));
  const valid = !fieldErrors.dao && !fieldErrors.proposalId && !fieldErrors.forumUrl && rowErrors.every((r) => !r.target && !r.calldata);
  const canSubmit = gate.ready && valid && ack && !flag.busy;
  // The first reason the button is unavailable, shown next to it.
  const blocker = !gate.isConnected ? "Connect a wallet to submit."
    : gate.wrongChain ? "Switch to GenLayer Studio Next to continue."
    : gate.insufficientFunds ? `Balance is below the ${formatGen(bond)} GEN bond.`
    : !valid ? "Complete every field to continue."
    : !ack ? "Acknowledge the bond terms to continue." : "";

  async function submit() {
    const ok = await flag.submit({ daoAddress: dao, proposalId, forumUrl, targets: rows.map((r) => r.target), calldatas: rows.map((r) => r.calldata) });
    if (ok) setTimeout(onClose, 1800);
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));
  const err = (k: string, msg: string) => (touched[k] && msg ? <p className="mt-1 text-[11px] text-rose-300">{msg}</p> : null);

  return (
    <dialog ref={dialog} onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()} aria-labelledby="flag-title"
      className="m-auto w-[min(660px,94vw)] max-h-[92vh] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/70 p-0 text-zinc-200 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
      <div className="scroll max-h-[92vh] overflow-auto p-6">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 id="flag-title" className="text-base font-semibold text-zinc-100">Challenge a proposal</h2>
            <p className="mt-1 text-xs text-zinc-500">Flag a proposal whose forum description does not match what its calldata executes.</p>
          </div>
          <button className="btn btn-quiet !p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
            <label className="block"><span className="eyebrow">DAO timelock</span>
              <input className="field mt-1.5 font-mono text-[13px]" list="dao-options" placeholder="0x…" value={dao} aria-invalid={touched.dao && !!fieldErrors.dao}
                onChange={(e) => setDao(e.target.value.trim())} onBlur={() => touch("dao")} />
              <datalist id="dao-options">{daoOptions.map((d) => <option key={d} value={d} />)}</datalist>
              {err("dao", fieldErrors.dao)}
            </label>
            <label className="block"><span className="eyebrow">Proposal id</span>
              <input className="field mt-1.5 font-mono" inputMode="numeric" placeholder="42" value={proposalId} aria-invalid={touched.pid && !!fieldErrors.proposalId}
                onChange={(e) => setProposalId(e.target.value.trim())} onBlur={() => touch("pid")} />
              {err("pid", fieldErrors.proposalId)}
            </label>
          </div>
          <label className="block"><span className="eyebrow">Forum URL</span>
            <input className="field mt-1.5" placeholder="https://forum.example-dao.org/t/proposal-42" value={forumUrl} aria-invalid={touched.url && !!fieldErrors.forumUrl}
              onChange={(e) => setForumUrl(e.target.value.trim())} onBlur={() => touch("url")} />
            {err("url", fieldErrors.forumUrl)}
          </label>

          <div>
            <div className="eyebrow mb-1.5">Execution actions ({rows.length}/{PROTOCOL.maxActions})</div>
            <div className="space-y-2.5">
              {rows.map((r, i) => {
                const decoded = ADDR.test(r.target) && HEX.test(r.calldata.trim()) && r.calldata.trim() !== "" ? decodeAction(i, r.target, r.calldata.trim().toLowerCase()) : null;
                return (
                  <div key={i} className="surface-inset space-y-2 p-3">
                    <div className="flex gap-2">
                      <input className="field font-mono text-[12.5px]" placeholder="Target 0x…" value={r.target} aria-label={`Action ${i + 1} target`}
                        aria-invalid={touched[`t${i}`] && !!rowErrors[i].target} onChange={(e) => update(i, { target: e.target.value.trim() })} onBlur={() => touch(`t${i}`)} />
                      {rows.length > 1 && <button className="btn btn-quiet !p-2" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove action ${i + 1}`}><X size={14} /></button>}
                    </div>
                    {err(`t${i}`, rowErrors[i].target)}
                    <textarea className="field min-h-[64px] font-mono text-[12.5px]" placeholder="Calldata 0x…" value={r.calldata} aria-label={`Action ${i + 1} calldata`}
                      aria-invalid={touched[`c${i}`] && !!rowErrors[i].calldata} onChange={(e) => update(i, { calldata: e.target.value })} onBlur={() => touch(`c${i}`)} />
                    {err(`c${i}`, rowErrors[i].calldata)}
                    {decoded?.selector && (
                      <div className="text-[11px] text-zinc-500">Decodes to <span className="font-mono text-indigo-300">{decoded.signature}</span>
                        {decoded.details.map((d) => <span key={d.label}> · {d.label} <span className="font-mono text-zinc-300">{d.value.split(" ")[0].slice(0, 20)}</span></span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {rows.length < PROTOCOL.maxActions && (
              <button className="btn btn-glass mt-2.5" onClick={() => setRows((rs) => [...rs, { target: "", calldata: "" }])}><Plus size={13} /> Add action</button>
            )}
          </div>

          {gate.wrongChain && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs text-amber-100">
              <span className="flex items-center gap-2"><Network size={15} /> Your wallet is on the wrong network.</span>
              <button type="button" className="btn btn-glass !py-1.5" disabled={gate.isSwitching} onClick={() => void gate.switchToStudioNext()}>
                {gate.isSwitching ? <Spinner size={13} /> : null} Switch to GenLayer Studio Next
              </button>
            </div>
          )}

          {/* Bond */}
          <div className="surface-inset p-4">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Challenge bond (exact)</span>
              <span className="figure text-xl font-semibold">{formatGen(bond)} GEN</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-zinc-500"><Wallet size={12} /> Wallet balance</span>
              <span className={`font-mono ${gate.insufficientFunds ? "text-rose-300" : "text-zinc-300"}`}>
                {!gate.isConnected ? "Not connected" : gate.balanceLoading ? "…" : gate.balance !== undefined ? `${formatGen(gate.balance, 3)} GEN` : "Unavailable"}
              </span>
            </div>
            {gate.insufficientFunds && <p role="alert" className="mt-2 text-[11px] text-rose-300">Insufficient balance: the bond alone needs {formatGen(bond)} GEN, before network fees.</p>}
            <div className="mt-3 flex gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs leading-relaxed text-amber-200/90">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span><strong className="font-semibold">{formatGen(bond)} GEN bond will be slashed if proposal is verified safe</strong> (half to the DAO, half burned) and you are locked out of flagging for 4 hours. If the breaker trips, the bond is returned with 10% of the DAO pool after the 24h appeal window.</span>
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
