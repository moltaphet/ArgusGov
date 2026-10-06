import type { ProposalStatus } from "@/lib/types";

const MAP: Record<ProposalStatus, { label: string; cls: string }> = {
  REGISTERED: { label: "Awaiting inspection", cls: "badge-mute" },
  ANALYZING: { label: "Verdict recorded", cls: "badge-warn" },
  VERIFIED_SAFE: { label: "Verified safe", cls: "badge-safe" },
  FLAGGED_MALICIOUS: { label: "Flagged malicious", cls: "badge-crit" },
  CHALLENGED_PAUSED: { label: "Appeal pending", cls: "badge-warn" },
  RESOLVED_DISPUTED: { label: "Dispute resolved", cls: "badge-mute" },
};

export function StatusBadge({ status }: { status: ProposalStatus }) {
  const s = MAP[status] ?? { label: status, cls: "badge-mute" };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}
