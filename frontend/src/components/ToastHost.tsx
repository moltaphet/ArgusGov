"use client";

import { AlertCircle, CheckCircle2, ExternalLink, X } from "lucide-react";
import { shortAddress } from "@/lib/format";
import { EXPLORER_URL } from "@/lib/networks";
import { dismissToast, useToasts } from "@/lib/toast";
import { Spinner } from "./Spinner";

export function ToastHost() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2.5" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"}
          className="surface pointer-events-auto flex animate-slideIn items-start gap-3 !rounded-xl p-3.5">
          <div className="mt-0.5">
            {t.tone === "pending" && <Spinner className="text-indigo-300" />}
            {t.tone === "success" && <CheckCircle2 size={16} className="text-emerald-400" />}
            {t.tone === "error" && <AlertCircle size={16} className="text-rose-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-zinc-100">{t.title}</div>
            {t.detail && <div className="mt-0.5 text-xs leading-relaxed text-zinc-400">{t.detail}</div>}
            {t.hash && (
              <a href={`${EXPLORER_URL}/transactions/${t.hash}`} target="_blank" rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-indigo-300 hover:underline">
                {shortAddress(t.hash, 10, 6)} <ExternalLink size={10} />
              </a>
            )}
          </div>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-zinc-500 hover:text-zinc-200"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
