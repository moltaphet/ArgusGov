const ATTO = 10n ** 18n;

export function toBig(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return 0n;
}

export function formatGen(atto: bigint, maxFraction = 4): string {
  const whole = atto / ATTO;
  const frac = atto % ATTO;
  if (frac === 0n) return whole.toLocaleString("en-US");
  const digits = frac.toString().padStart(18, "0").slice(0, maxFraction).replace(/0+$/, "");
  return digits ? `${whole.toLocaleString("en-US")}.${digits}` : whole.toLocaleString("en-US");
}

export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 2) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function timeAgo(unixSeconds: number, now = Date.now() / 1000): string {
  const delta = Math.max(0, Math.floor(now - unixSeconds));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function countdown(seconds: number): string {
  if (seconds <= 0) return "closed";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
