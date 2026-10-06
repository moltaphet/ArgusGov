import { PROTOCOL } from "@/lib/networks";

export interface Severity {
  label: string;
  color: string;
  badge: string;
}

export function severityFor(score: number, pending: boolean): Severity {
  if (pending) return { label: "AWAITING INSPECTION", color: "#71717a", badge: "badge-mute" };
  if (score >= PROTOCOL.threatThreshold) return { label: "CRITICAL: HIGH DISCREPANCY", color: "#f43f5e", badge: "badge-crit" };
  if (score > 25) return { label: "ELEVATED: PARTIAL MISMATCH", color: "#f59e0b", badge: "badge-warn" };
  return { label: "LOW: INTENT MATCHES CALLS", color: "#10b981", badge: "badge-safe" };
}

// Geometry. The ring is a 270-degree arc whose open side faces down, so the
// drawing area is cropped to the arc's lowest point instead of a full square.
const WIDTH = 200;
const HEIGHT = 168;
const CX = 100;
const CY = 100;
const RADIUS = 78;
const STROKE = 12;
const START_DEG = 135;
const SWEEP_DEG = 270;

/** Point on the arc's centre line for a 0-100 value. */
function pointAt(value: number): [number, number] {
  const angle = (START_DEG + SWEEP_DEG * (value / 100)) * (Math.PI / 180);
  return [CX + RADIUS * Math.cos(angle), CY + RADIUS * Math.sin(angle)];
}

/** 270-degree ring gauge: animated glow, radar rings, and a marker dot at the breaker threshold. */
export function ThreatGauge({ score, pending }: { score: number; pending?: boolean }) {
  const circumference = 2 * Math.PI * RADIUS;
  const sweep = circumference * (SWEEP_DEG / 360);
  const clamped = Math.max(0, Math.min(100, score));
  const sev = severityFor(clamped, Boolean(pending));
  const critical = !pending && clamped >= PROTOCOL.threatThreshold;
  const [mx, my] = pointAt(PROTOCOL.threatThreshold);

  return (
    <div className="flex flex-col items-center gap-4" role="img"
      aria-label={pending ? "Threat score pending" : `Threat score ${clamped} out of 100. ${sev.label}. The circuit breaker trips at ${PROTOCOL.threatThreshold}.`}>
      <div className="relative" style={{ width: WIDTH, height: HEIGHT }}>
        {!pending && (
          <div aria-hidden className="absolute left-6 top-6 h-[130px] w-[148px] animate-glow rounded-full blur-2xl" style={{ background: sev.color, opacity: 0.28 }} />
        )}

        {/* Radar rings stay inside the dial, are clipped at the arc's lowest point, and fade out
            before the label below, so nothing can cross the badge. */}
        {!pending && clamped > 25 && (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_62%,transparent_100%)]">
            {Array.from({ length: critical ? 3 : 1 }, (_, i) => (
              <span key={i} className="absolute left-0 top-0 h-[200px] w-[200px] animate-gaugeRadar rounded-full border"
                style={{ borderColor: sev.color, animationDelay: `${i * 1.2}s`, animationDuration: critical ? "3.6s" : "5.5s" }} />
            ))}
          </div>
        )}

        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} className="relative block overflow-visible" aria-hidden>
          <circle cx={CX} cy={CY} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={`${sweep} ${circumference}`} transform={`rotate(${START_DEG} ${CX} ${CY})`} />
          {!pending && (
            <circle cx={CX} cy={CY} r={RADIUS} fill="none" stroke={sev.color} strokeWidth={STROKE} strokeLinecap="round"
              strokeDasharray={`${(sweep * clamped) / 100} ${circumference}`} transform={`rotate(${START_DEG} ${CX} ${CY})`}
              style={{ transition: "stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)", filter: `drop-shadow(0 0 8px ${sev.color})` }} />
          )}
          {/* Threshold marker: a dot on the arc itself, outlined in canvas colour so it reads on top of the stroke. */}
          <circle cx={mx} cy={my} r={6.5} fill="rgba(244,244,245,0.18)" />
          <circle cx={mx} cy={my} r={3.4} fill="#f4f4f5" stroke="#09090b" strokeWidth={1.6} style={{ filter: "drop-shadow(0 0 4px rgba(244,244,245,0.9))" }} />
        </svg>

        {/* Score and denominator, centred on the dial's own centre. */}
        <div className="absolute inset-x-0 flex -translate-y-1/2 flex-col items-center" style={{ top: CY }}>
          {pending ? (
            <span className="text-sm font-medium text-zinc-500">Pending</span>
          ) : (
            <>
              <span className="figure text-[56px] font-bold leading-none tracking-tighter" style={{ color: sev.color, textShadow: `0 0 32px ${sev.color}aa, 0 0 2px ${sev.color}` }}>{clamped}</span>
              <span className="mt-2 font-mono text-xs leading-none text-zinc-500">/ 100</span>
            </>
          )}
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2">
        <span className={`badge ${sev.badge} whitespace-nowrap px-3 py-1 tracking-wide`}>{sev.label}</span>
        <span className="text-[11px] leading-none text-zinc-500">Breaker trips at {PROTOCOL.threatThreshold}</span>
      </div>
    </div>
  );
}
