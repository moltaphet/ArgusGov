"use client";

import { Flag, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { decodeAction } from "@/lib/decode";
import { formatGen } from "@/lib/format";
import { MONITORED_DAOS, PROTOCOL } from "@/lib/networks";
import { WriteStatus } from "./ProposalInspector";
import { useWrite } from "./useWrite";

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

export function FlagModal({ open, onClose, knownDaos }: { open: boolean; onClose: () => void; knownDaos: string[] }) {
  const { isConnected } = useAccount();
  const write = useWrite();
  const dialog = useRef<HTMLDialogElement>(null);
  const [dao, setDao] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [forumUrl, setForumUrl] = useState("");
  const [rows, setRows] = useState<Row[]>([{ target: "", calldata: "" }]);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const daoOptions = useMemo(() => Array.from(new Set([...knownDaos, ...MONITORED_DAOS])), [knownDaos]);
  const errors = useMemo(() => {
    const list: string[] = [];
    if (!ADDR.test(dao)) list.push("DAO timelock must be a 0x address (40 hex characters).");
    if (!/^\d+$/.test(proposalId)) list.push("Proposal id must be a non-negative integer.");
    if (!validUrl(forumUrl)) list.push("Forum URL must be a public http(s) link.");
    rows.forEach((r, i) => {
      if (!ADDR.test(r.target)) list.push(`Action ${i + 1}: target must be a 0x address.`);
      if (!HEX.test(r.calldata.trim())) list.push(`Action ${i + 1}: calldata must be even-length 0x hex.`);
    });
    return list;
  }, [dao, proposalId, forumUrl, rows]);

  const canSubmit = isConnected && errors.length === 0 && ack && !write.busy;

  async function submit() {
    const ok = await write.run(
      "flag_proposal",
      [dao.toLowerCase(), BigInt(proposalId), forumUrl, rows.map((r) => r.target.toLowerCase()), rows.map((r) => r.calldata.trim().toLowerCase())],
      PROTOCOL.minChallengeBond,
    );
    if (ok) setTimeout(onClose, 1400);
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="glass m-auto w-[min(680px,94vw)] max-h-[92vh] overflow-hidden !p-0 text-[var(--text)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      aria-labelledby="flag-title"
    >
      <div className="scroll max-h-[92vh] overflow-auto p-7">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 id="flag-title" className="text-xl font-semibold">Flag a proposal</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Challenge a proposal whose forum description does not match its calldata.</p>
          </div>
          <button className="btn btn-ghost !p-2" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <label className="block"><span className="label">DAO timelock</span>
              <input className="field mono mt-1" list="dao-options" placeholder="0x…" value={dao} onChange={(e) => setDao(e.target.value.trim())} />
              <datalist id="dao-options">{daoOptions.map((d) => <option key={d} value={d} />)}</datalist>
            </label>
            <label className="block"><span className="label">Proposal id</span>
              <input className="field mt-1" inputMode="numeric" placeholder="42" value={proposalId} onChange={(e) => setProposalId(e.target.value.trim())} />
            </label>
          </div>
          <label className="block"><span className="label">Forum URL</span>
            <input className="field mt-1" placeholder="https://forum.example-dao.org/t/proposal-42" value={forumUrl} onChange={(e) => setForumUrl(e.target.value.trim())} />
          </label>

          <div>
            <div className="label mb-1">Execution actions ({rows.length}/{PROTOCOL.maxActions})</div>
            <div className="space-y-3">
              {rows.map((r, i) => {
                const decoded = ADDR.test(r.target) && HEX.test(r.calldata.trim()) ? decodeAction(i, r.target, r.calldata.trim().toLowerCase()) : null;
                return (
                  <div key={i} className="glass-inner space-y-2 p-3">
                    <div className="flex gap-2">
                      <input className="field mono" placeholder="Target 0x…" value={r.target} onChange={(e) => update(i, { target: e.target.value.trim() })} aria-label={`Action ${i + 1} target`} />
                      {rows.length > 1 && <button className="btn btn-ghost !p-2" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove action ${i + 1}`}><X size={14} /></button>}
                    </div>
                    <textarea className="field mono min-h-[68px]" placeholder="Calldata 0x…" value={r.calldata} onChange={(e) => update(i, { calldata: e.target.value })} aria-label={`Action ${i + 1} calldata`} />
                    {decoded && decoded.selector && (
                      <div className="text-xs text-[var(--muted)]">
                        Decodes to <span className="mono text-[var(--text)]">{decoded.signature}</span>
                        {decoded.details.map((d) => <span key={d.label}> · {d.label} <span className="mono">{d.value.split(" ")[0].slice(0, 22)}</span></span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {rows.length < PROTOCOL.maxActions && (
              <button className="btn btn-ghost mt-2" onClick={() => setRows((rs) => [...rs, { target: "", calldata: "" }])}><Plus size={14} /> Add action</button>
            )}
          </div>

          <div className="glass-inner p-4">
            <div className="flex items-baseline justify-between">
              <span className="label">Challenge bond (exact)</span>
              <span className="text-2xl font-semibold tabular-nums">{formatGen(PROTOCOL.minChallengeBond)} GEN</span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
              <li>Circuit breaker trips (score ≥ {PROTOCOL.threatThreshold}): bond refunded plus 10% of the DAO pool, vested after the 24h appeal window.</li>
              <li>False alarm: the bond is slashed, half to the DAO and half burned, with a 4h lockout.</li>
            </ul>
            <label className="mt-3 flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I understand the bond is forfeited if validators judge this proposal safe.
            </label>
          </div>

          {errors.length > 0 && (dao || proposalId || forumUrl || rows[0].target) && (
            <ul className="space-y-0.5 text-xs text-[var(--amber)]" aria-live="polite">{errors.slice(0, 3).map((e) => <li key={e}>{e}</li>)}</ul>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-danger" disabled={!canSubmit} onClick={submit}>
              <Flag size={16} /> {write.busy ? "Submitting…" : `Post ${formatGen(PROTOCOL.minChallengeBond)} GEN bond & flag`}
            </button>
            {!isConnected && <span className="text-xs text-[var(--muted)]">Connect a wallet to submit.</span>}
            <WriteStatus state={write.state} />
          </div>
        </div>
      </div>
    </dialog>
  );
}
