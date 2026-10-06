"use client";

import { FilePlus2, Hash, Plus, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { parseEther } from "viem";
import { useAccount } from "wagmi";
import { useChainGate } from "@/hooks/useChainGate";
import { useCommitProposal } from "@/hooks/useCommitProposal";
import { decodeAction } from "@/lib/decode";
import { shortAddress } from "@/lib/format";
import { PROTOCOL } from "@/lib/networks";
import type { DaoSummary } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import { Spinner } from "./Spinner";
import { TxProgress } from "./TxProgress";

interface Row { target: string; value: string; calldata: string }
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x([0-9a-fA-F]{2})*$/;
const emptyRow = (): Row => ({ target: "", value: "0", calldata: "0x" });

function parseNative(value: string): bigint | null {
  try {
    return parseEther(value.trim() === "" ? "0" : value.trim());
  } catch {
    return null;
  }
}

function validUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && value.length <= 512;
  } catch {
    return false;
  }
}

/**
 * Guardian console. A DAO's guardian (or its timelock) commits the payload a proposal will
 * execute; challengers can then flag it by id alone. Commitments are write-once.
 */
export function CommitProposalPanel({ daos }: { daos: DaoSummary[] }) {
  const { address } = useAccount();
  const gate = useChainGate(0n);
  const commit = useCommitProposal();
  const me = address?.toLowerCase();
  const mine = useMemo(
    () => daos.filter((d) => me && d.pool && (d.pool.guardian.toLowerCase() === me || d.address.toLowerCase() === me)),
    [daos, me],
  );

  const [daoKey, setDaoKey] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [forumUrl, setForumUrl] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const selectedKey = daoKey || mine[0]?.key || "";

  const parsedValues = rows.map((r) => parseNative(r.value));
  const errors = useMemo(() => {
    const out: string[] = [];
    if (!/^\d+$/.test(proposalId)) out.push("Proposal id must be a non-negative whole number.");
    if (!validUrl(forumUrl)) out.push("Forum URL must be a public http(s) link.");
    rows.forEach((r, i) => {
      if (!ADDR.test(r.target)) out.push(`Action ${i + 1}: target must be a 0x address.`);
      if (!HEX.test(r.calldata.trim())) out.push(`Action ${i + 1}: calldata must be even-length 0x hex.`);
      if (parsedValues[i] === null) out.push(`Action ${i + 1}: value must be a number of native units.`);
    });
    return out;
  }, [proposalId, forumUrl, rows, parsedValues]);
  const valid = errors.length === 0 && Boolean(selectedKey);

  // The commitment the contract will store, so the guardian can compare it with the DAO's own hash.
  const expected = useMemo(() => {
    if (!valid) return "";
    try {
      return commit.expectedHash({ targets: rows.map((r) => r.target), values: parsedValues as bigint[], calldatas: rows.map((r) => r.calldata), forumUrl });
    } catch {
      return "";
    }
  }, [valid, rows, parsedValues, forumUrl, commit]);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const blocker = !gate.isConnected ? "Connect the guardian wallet to commit."
    : gate.wrongChain ? "Switch to GenLayer Studio Next to continue."
    : mine.length === 0 ? "This wallet is not the guardian of a registered DAO."
    : !valid ? "Complete every field to continue." : "";
  const canSubmit = gate.ready && mine.length > 0 && valid && !commit.busy;

  async function submit() {
    const ok = await commit.commit({ daoKey: selectedKey, proposalId, forumUrl, targets: rows.map((r) => r.target), values: parsedValues as bigint[], calldatas: rows.map((r) => r.calldata) });
    if (ok) {
      setProposalId("");
      setForumUrl("");
      setRows([emptyRow()]);
    }
  }

  return (
    <section id="guardian-console" className="surface animate-rise scroll-mt-6 p-6" aria-labelledby="commit-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="commit-heading" className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <FilePlus2 size={15} className="text-indigo-300" /> Commit proposal
            <span className="badge badge-mute">Guardian console</span>
          </h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-zinc-500">
            Record exactly what a proposal will execute. Challengers can then flag it by id alone, so nobody else can put forged calldata
            under your proposal. A commitment is write-once and is fingerprinted with the same keccak256(abi.encode(...)) layout Governor contracts use for proposal ids.
          </p>
        </div>
        {mine.length > 0 && <span className="badge badge-safe"><ShieldCheck size={11} /> Guardian of {mine.length} DAO{mine.length === 1 ? "" : "s"}</span>}
      </div>

      {mine.length === 0 ? (
        <div className="surface-inset mt-5 p-4 text-xs leading-relaxed text-zinc-400" data-testid="not-guardian">
          {!gate.isConnected ? "Connect a wallet to see the DAOs it guards." : "This wallet is not the guardian, or the timelock, of a registered DAO, so it cannot commit proposals."}
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <label className="block"><span className="eyebrow">DAO</span>
              <select className="field mt-1.5 font-mono text-[13px]" value={selectedKey} onChange={(e) => setDaoKey(e.target.value)}>
                {mine.map((d) => <option key={d.key} value={d.key}>{shortAddress(d.address, 8, 6)} · chain {d.chainId}</option>)}
              </select>
            </label>
            <label className="block"><span className="eyebrow">Proposal id</span>
              <input className="field mt-1.5 font-mono" inputMode="numeric" placeholder="42" value={proposalId} onChange={(e) => setProposalId(e.target.value.trim())} />
            </label>
          </div>
          <label className="block"><span className="eyebrow">Forum URL</span>
            <input className="field mt-1.5" placeholder="https://forum.example-dao.org/t/proposal-42" value={forumUrl} onChange={(e) => setForumUrl(e.target.value.trim())} />
          </label>

          <div>
            <div className="eyebrow mb-1.5">Execution actions ({rows.length}/{PROTOCOL.maxActions})</div>
            <div className="space-y-2.5">
              {rows.map((r, i) => {
                const v = parsedValues[i];
                const decoded = ADDR.test(r.target) && HEX.test(r.calldata.trim()) && v !== null ? decodeAction(i, r.target, r.calldata.trim().toLowerCase(), v) : null;
                return (
                  <div key={i} className="surface-inset space-y-2 p-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                      <input className="field font-mono text-[12.5px]" placeholder="Target 0x…" value={r.target} aria-label={`Action ${i + 1} target`} onChange={(e) => update(i, { target: e.target.value.trim() })} />
                      <input className="field font-mono text-[12.5px]" placeholder="Native value" value={r.value} aria-label={`Action ${i + 1} native value`} aria-invalid={v === null} onChange={(e) => update(i, { value: e.target.value })} />
                      {rows.length > 1 ? <button className="btn btn-quiet !p-2" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove action ${i + 1}`}><X size={14} /></button> : <span />}
                    </div>
                    <textarea className="field min-h-[60px] font-mono text-[12.5px]" placeholder="Calldata 0x…" value={r.calldata} aria-label={`Action ${i + 1} calldata`} onChange={(e) => update(i, { calldata: e.target.value })} />
                    {decoded && <div className="text-[11px] text-zinc-500">Decodes to <span className="font-mono text-indigo-300">{decoded.signature}</span> · {decoded.category.replace(/_/g, " ").toLowerCase()}</div>}
                  </div>
                );
              })}
            </div>
            {rows.length < PROTOCOL.maxActions && (
              <button className="btn btn-glass mt-2.5" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Plus size={13} /> Add action</button>
            )}
          </div>

          <div className="surface-inset flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs">
            <span className="flex items-center gap-1.5 text-zinc-500"><Hash size={13} /> Commitment the contract will store</span>
            {expected ? (
              <span className="flex items-center gap-1 font-mono text-zinc-200" data-testid="expected-hash">{shortAddress(expected, 12, 8)}<CopyButton value={expected} label="Copy commitment" /></span>
            ) : <span className="text-zinc-600">Complete the form to compute it</span>}
          </div>

          <TxProgress status={commit.status} error={commit.error} onRetry={commit.reset}
            labels={{ submit: "Checking authority and signing", confirm: "Waiting for Block Confirmation", done: "Committed & open for challenge" }} />

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-glass" disabled={!canSubmit} onClick={submit}>
              {commit.busy ? <Spinner /> : <FilePlus2 size={14} />} {commit.busy ? "Working…" : "Commit proposal"}
            </button>
            {blocker && !commit.busy && <span className="text-xs text-zinc-500" data-testid="commit-blocker">{blocker}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
