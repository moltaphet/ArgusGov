import { PROTOCOL } from "@/lib/networks";

function band(score: number): { color: string; label: string } {
  if (score >= PROTOCOL.threatThreshold) return { color: "var(--red)", label: "Malicious" };
  if (score > 25) return { color: "var(--amber)", label: "Suspicious" };
  return { color: "var(--green)", label: "Consistent" };
}

/** Semicircular discrepancy gauge, 0-100, with the circuit-breaker threshold marked. */
export function ThreatGauge({ score, pending }: { score: number; pending?: boolean }) {
  const r = 84;
  const cx = 110;
  const cy = 108;
  const arc = Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const { color, label } = band(clamped);
  const t = PROTOCOL.threatThreshold / 100;
  const tx = cx - r * Math.cos(Math.PI * t);
  const ty = cy - r * Math.sin(Math.PI * t);
  const tx2 = cx - (r + 14) * Math.cos(Math.PI * t);
  const ty2 = cy - (r + 14) * Math.sin(Math.PI * t);
  const path = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <div className="relative mx-auto w-[220px]" role="img" aria-label={pending ? "Threat score pending" : `Threat score ${clamped} of 100, ${label}`}>
      <svg viewBox="0 0 220 128" className="w-full overflow-visible">
        <path d={path} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="14" strokeLinecap="round" />
        {!pending && (
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={arc}
            strokeDashoffset={arc * (1 - clamped / 100)}
            style={{ transition: "stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)", filter: `drop-shadow(0 0 10px ${color})` }}
          />
        )}
        <line x1={tx} y1={ty} x2={tx2} y2={ty2} stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" />
        <text x={tx2 + 4} y={ty2 - 4} fill="rgba(235,235,245,0.6)" fontSize="9" fontWeight="600">
          {PROTOCOL.threatThreshold}
        </text>
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        {pending ? (
          <div className="text-lg font-semibold text-[var(--muted)]">Pending</div>
        ) : (
          <>
            <div className="text-[44px] font-semibold leading-none tabular-nums" style={{ color }}>{clamped}</div>
            <div className="mt-1 text-xs font-medium" style={{ color }}>{label}</div>
          </>
        )}
      </div>
    </div>
  );
}
