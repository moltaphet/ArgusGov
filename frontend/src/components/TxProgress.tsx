"use client";

import { AlertCircle, Check } from "lucide-react";
import type { DecodedError } from "@/lib/errors";
import type { WriteStatus } from "@/hooks/useContractWrite";
import { Spinner } from "./Spinner";

export interface ProgressLabels {
  submit: string;
  confirm: string;
  done: string;
}

/** Index of the active step: 0 submitting, 1 confirming, 2 finished. */
export function stepFor(status: WriteStatus): number {
  if (status === "decided") return 2;
  if (status === "submitted" || status === "consensus") return 1;
  return 0;
}

/** Glass three-step progress for a payable write. */
export function TxProgress({ status, labels, error, onRetry }: { status: WriteStatus; labels: ProgressLabels; error?: DecodedError; onRetry?: () => void }) {
  if (status === "idle") return null;
  const active = stepFor(status);
  const failed = status === "error";
  const steps = [labels.submit, labels.confirm, labels.done];
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
      <ol className="space-y-3">
        {steps.map((label, i) => {
          const done = !failed && (i < active || (i === 2 && status === "decided"));
          const current = !failed && i === active && status !== "decided";
          return (
            <li key={label} className="flex items-center gap-3">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] transition-all duration-300 ${
                done ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300" : current ? "border-indigo-300/50 bg-indigo-400/10 text-indigo-200" : "border-white/10 text-zinc-600"}`}>
                {done ? <Check size={13} /> : current ? <Spinner size={13} /> : i + 1}
              </span>
              <span className={`text-[13px] transition-colors ${done ? "text-zinc-200" : current ? "font-medium text-zinc-100" : "text-zinc-600"}`}>{label}</span>
            </li>
          );
        })}
      </ol>
      {failed && error && (
        <div role="alert" className="mt-4 flex gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.08] p-3 text-xs leading-relaxed text-rose-200">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">{error.title}</div>
            <div className="mt-0.5 text-rose-200/80">{error.message}</div>
            {onRetry && <button type="button" className="mt-2 text-[11px] font-medium text-rose-100 underline underline-offset-2" onClick={onRetry}>Dismiss</button>}
          </div>
        </div>
      )}
    </div>
  );
}
