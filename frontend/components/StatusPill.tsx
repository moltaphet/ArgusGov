import type { ProposalStatus } from "@/lib/types";

const STYLE: Record<ProposalStatus, { label: string; color: string }> = {
  REGISTERED: { label: "Awaiting inspection", color: "var(--blue)" },
  ANALYZING: { label: "Verdict recorded", color: "var(--amber)" },
  VERIFIED_SAFE: { label: "Verified safe", color: "var(--green)" },
  FLAGGED_MALICIOUS: { label: "Flagged malicious", color: "var(--red)" },
  CHALLENGED_PAUSED: { label: "Appeal pending", color: "var(--amber)" },
  RESOLVED_DISPUTED: { label: "Dispute resolved", color: "var(--muted)" },
};

export function StatusPill({ status }: { status: ProposalStatus }) {
  const s = STYLE[status] ?? { label: status, color: "var(--muted)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 14%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}
