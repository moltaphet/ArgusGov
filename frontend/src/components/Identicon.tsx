// Deterministic 5x5 mirrored identicon derived from an address. Pure SVG, no network.
function hash(address: string): number[] {
  let h = 2166136261;
  const out: number[] = [];
  const clean = address.toLowerCase();
  for (let i = 0; i < 24; i++) {
    h ^= clean.charCodeAt(i % clean.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    out.push(h);
  }
  return out;
}

export function Identicon({ address, size = 36 }: { address: string; size?: number }) {
  const bits = hash(address);
  const hue = bits[0] % 360;
  const cells: boolean[][] = Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) => bits[y * 3 + Math.min(x, 4 - x) + 1] % 3 !== 0),
  );
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" className="shrink-0 rounded-[10px] ring-1 ring-white/10" role="img" aria-label={`Avatar for ${address}`}>
      <rect width="5" height="5" fill={`hsl(${hue} 28% 14%)`} />
      {cells.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}${y}`} x={x} y={y} width="1" height="1" fill={`hsl(${hue} 62% 66%)`} opacity={0.9} /> : null)))}
    </svg>
  );
}
