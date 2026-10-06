"use client";

import { AlertTriangle, ExternalLink, FileText, Terminal } from "lucide-react";
import { useMemo } from "react";
import type { DecodedAction } from "@/lib/decode";
import { formatTokens } from "@/lib/format";
import { compareAmount, findAmountMentions, tokensFromRaw, type AmountVerdict } from "@/lib/intent";
import { shortAddress } from "@/lib/format";
import { Markdown } from "./Markdown";

export interface ForumState {
  loading: boolean;
  available: boolean;
  text: string;
  error?: string;
}

export function DeclaredIntentCard({ url, forum }: { url: string; forum: ForumState }) {
  const host = (() => {
    try { return new URL(url).hostname; } catch { return url; }
  })();
  return (
    <div className="surface-inset flex min-h-[280px] flex-col">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="flex items-center gap-2 text-xs font-medium text-zinc-300"><FileText size={14} className="text-zinc-500" /> Declared intent</span>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:underline">
          {host} <ExternalLink size={10} />
        </a>
      </div>
      <div className="scroll max-h-[360px] flex-1 overflow-auto p-4">
        {forum.loading && <div className="space-y-2" aria-busy><div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.06]" /><div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" /><div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06]" /></div>}
        {!forum.loading && forum.available && <Markdown source={forum.text} />}
        {!forum.loading && !forum.available && (
          <div className="flex gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs leading-relaxed text-amber-200/90">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>The post could not be read{forum.error ? ` (${forum.error})` : ""}. Validators treat an unreadable post as <em>no declared intent</em>, so every privileged call is undisclosed.</span>
          </div>
        )}
      </div>
    </div>
  );
}

const FN = "#22d3ee"; // method names: cyan
const ADDR = "#e8c15a"; // address hashes: gold
const NUM = "#fdba74";

function Line({ n, danger, children, note }: { n: number; danger?: boolean; children: React.ReactNode; note?: string }) {
  return (
    <div className={`flex gap-3 border-l-2 px-3 py-[3px] ${danger ? "border-rose-500 bg-rose-500/[0.14] shadow-[inset_0_0_24px_rgba(244,63,94,0.12)]" : "border-transparent"}`}>
      <span className="w-5 shrink-0 select-none text-right text-zinc-700">{n}</span>
      <span className={`min-w-0 flex-1 break-all ${danger ? "text-rose-300" : "text-zinc-400"}`}>
        {children}
        {note && <span className="ml-3 inline-flex items-center gap-1 rounded bg-rose-500/30 px-1.5 text-[10px] font-semibold tracking-wide text-rose-200"><AlertTriangle size={10} />{note}</span>}
      </span>
    </div>
  );
}

function verdictNote(v: AmountVerdict): string | undefined {
  if (v.kind === "undisclosed") return "UNDECLARED AMOUNT";
  if (v.kind === "exceeds") return `${v.ratio >= 10 ? Math.round(v.ratio).toLocaleString("en-US") : v.ratio.toFixed(1)}x DECLARED`;
  return undefined;
}

export function CalldataTerminal({ actions, forumText }: { actions: DecodedAction[]; forumText: string }) {
  const mentions = useMemo(() => findAmountMentions(forumText), [forumText]);
  let n = 0;
  return (
    <div className="surface-inset flex min-h-[280px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="flex items-center gap-2 text-xs font-medium text-zinc-300"><Terminal size={14} className="text-zinc-500" /> Decoded on-chain calldata</span>
        <span className="flex gap-1.5" aria-hidden><i className="h-2 w-2 rounded-full bg-zinc-700" /><i className="h-2 w-2 rounded-full bg-zinc-700" /><i className="h-2 w-2 rounded-full bg-zinc-700" /></span>
      </div>
      <div className="relative flex-1 bg-black/40">
        <div aria-hidden className="scanlines pointer-events-none absolute inset-0" />
        <div className="scroll relative max-h-[340px] overflow-auto py-3 font-mono text-[12px] leading-[1.7]">
        {actions.map((a) => {
          const tokens = a.amountRaw !== undefined && a.category !== "TOKEN_APPROVAL" ? tokensFromRaw(a.amountRaw) : undefined;
          const verdict = tokens !== undefined ? compareAmount(tokens, mentions) : undefined;
          const amountDanger = verdict !== undefined && verdict.kind !== "consistent";
          const privileged = a.severity === "critical";
          const fname = a.signature.split("(")[0] || a.category.toLowerCase();
          return (
            <div key={a.index} className="mb-3 last:mb-0">
              <Line n={++n}><span className="text-zinc-600">{"// "}action {a.index} → {shortAddress(a.target, 8, 6)} · {a.category}</span></Line>
              <Line n={++n} danger={privileged} note={privileged ? "PRIVILEGED CALL" : undefined}>
                <span style={{ color: privileged ? undefined : FN }}>{fname}</span><span className="text-zinc-600">(</span>
              </Line>
              {a.details.map((d) => {
                const isAmount = d.label === "amount";
                const isAddr = /^0x[0-9a-f]{40}$/i.test(d.value);
                const dangerous = isAmount && amountDanger;
                const display = isAmount && a.amountRaw !== undefined ? (a.amountRaw === 2n ** 256n - 1n ? "UNLIMITED" : `${formatTokens(a.amountRaw)} tokens`) : d.value;
                return (
                  <Line key={d.label} n={++n} danger={dangerous} note={dangerous ? verdictNote(verdict!) : undefined}>
                    <span className="pl-5 text-zinc-500">{d.label.replace(/ /g, "_")}: </span>
                    <span style={{ color: dangerous ? undefined : isAddr ? ADDR : isAmount ? NUM : "#d4d4d8" }}>{display}</span>
                  </Line>
                );
              })}
              {a.details.length === 0 && <Line n={++n}><span className="pl-5 text-zinc-600">{a.summary}</span></Line>}
              <Line n={++n}><span className="text-zinc-600">)</span></Line>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
