export { EXPLORER_URL, GENLAYER_STUDIO_NEXT_ID, genlayerStudioNext, RPC_URL } from "./contracts/chain";

// Deployment recorded in deployments/studio-next.json.
export const ARGUS_ADDRESS = (process.env.NEXT_PUBLIC_ARGUS_ADDRESS ??
  "0x34F50f2A05f7d56B5B0B827862D33B22f63d767A") as `0x${string}`;

// ArgusGov has no on-chain DAO enumeration, so the dashboard unions the DAOs it
// finds on flagged proposals with this list of timelocks to watch.
export const MONITORED_DAOS: string[] = (
  process.env.NEXT_PUBLIC_MONITORED_DAOS ?? "0xd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1"
)
  .split(",")
  .map((a) => a.trim().toLowerCase())
  .filter((a) => /^0x[0-9a-f]{40}$/.test(a));

// Protocol constants, mirrored from contracts/argus_gov.py.
export const PROTOCOL = {
  minChallengeBond: 2n * 10n ** 18n,
  threatThreshold: 75,
  appealWindowSeconds: 24 * 3600,
  coolingSeconds: 4 * 3600,
  maxActions: 10,
} as const;
