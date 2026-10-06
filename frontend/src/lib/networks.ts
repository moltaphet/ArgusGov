export { EXPLORER_URL, GENLAYER_STUDIO_NEXT_ID, genlayerStudioNext, RPC_URL } from "./contracts/chain";

// Deployment recorded in deployments/studio-next.json.
export const ARGUS_ADDRESS = (process.env.NEXT_PUBLIC_ARGUS_ADDRESS ??
  "0x8b7bB0e8aCddFC15f675DaEFfBAd0c89481FE2C1") as `0x${string}`;

// DAOs are identified by "<chain_id>:<0xtimelock>". The dashboard enumerates registered DAOs
// on-chain; this list adds keys to show before anything is registered or committed.
export const MONITORED_DAOS: string[] = (
  process.env.NEXT_PUBLIC_MONITORED_DAOS ?? "61997:0xd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1"
)
  .split(",")
  .map((a) => a.trim().toLowerCase())
  .filter((a) => /^\d{1,20}:0x[0-9a-f]{40}$/.test(a));

// Protocol constants, mirrored from contracts/argus_gov.py.
export const PROTOCOL = {
  minChallengeBond: 2n * 10n ** 18n,
  threatThreshold: 75,
  appealWindowSeconds: 24 * 3600,
  flagExpirySeconds: 7 * 24 * 3600,
  /** Only the challenger may inspect for this long after a flag. */
  inspectionExclusiveSeconds: 30 * 60,
  coolingSeconds: 4 * 3600,
  maxActions: 10,
} as const;
