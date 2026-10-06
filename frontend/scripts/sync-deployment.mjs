// Copies the recorded deployment (consensus transaction hashes per proposal) into
// the app bundle so the dashboard can show validator quorum and reasoning for it.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "../deployments/studio-next.json");
const target = resolve(root, "src/data/studio-next.json");
if (existsSync(source)) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
