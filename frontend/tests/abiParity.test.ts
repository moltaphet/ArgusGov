// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { argusGovAbi } from "@/lib/contracts/argusGovABI";

// Drift guard: the method table the frontend calls must describe the contract that is
// actually in the repository: same names, mutability, payability and argument order.
const source = readFileSync(resolve(__dirname, "../../contracts/argus_gov.py"), "utf-8");

interface ParsedMethod { name: string; kind: "write" | "view"; payable: boolean; inputs: string[] }

function parseContract(): ParsedMethod[] {
  const out: ParsedMethod[] = [];
  const pattern = /@gl\.public\.(write\.payable|write|view)\s*\n\s*def (\w+)\(\s*([\s\S]*?)\)\s*->/g;
  for (const m of source.matchAll(pattern)) {
    const params = m[3].split(",").map((p) => p.trim().split(":")[0].trim()).filter((p) => p && p !== "self");
    out.push({ name: m[2], kind: m[1] === "view" ? "view" : "write", payable: m[1] === "write.payable", inputs: params });
  }
  return out;
}

describe("ABI table matches contracts/argus_gov.py", () => {
  const contract = parseContract();

  it("finds the contract's public methods", () => {
    expect(contract.length).toBeGreaterThan(20);
  });

  it("describes every public method, and nothing the contract lacks", () => {
    expect(argusGovAbi.map((m) => m.name).sort()).toEqual(contract.map((m) => m.name).sort());
  });

  it.each(argusGovAbi.map((m) => [m.name, m] as const))("%s has the same mutability, payability and arguments", (name, entry) => {
    const real = contract.find((m) => m.name === name);
    expect(real, `contract defines ${name}`).toBeDefined();
    expect(entry.kind).toBe(real!.kind);
    expect(entry.payable).toBe(real!.payable);
    expect(entry.inputs.map((i) => i.name)).toEqual(real!.inputs);
  });

  it("no longer lets a flag carry a payload", () => {
    const flag = argusGovAbi.find((m) => m.name === "flag_proposal")!;
    expect(flag.inputs.map((i) => i.name)).toEqual(["dao_key", "proposal_id"]);
  });
});
