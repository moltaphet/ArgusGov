import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AboutSection } from "@/components/AboutSection";
import { Footer } from "@/components/Footer";
import { shortAddress } from "@/lib/format";
import { ARGUS_ADDRESS, EXPLORER_URL } from "@/lib/networks";
import { DOCS_URL, REPO_URL, TEST_COUNTS } from "@/lib/project";
import { withQuery } from "./helpers";

vi.mock("@/lib/genlayer", () => ({
  readView: vi.fn(async (name: string) => (name === "solvency" ? true : { total_pool: 0, total_escrow: 0, total_claimable: 0, burn_vault: 0, balance: 0 })),
  sendWrite: vi.fn(),
}));

const root = resolve(__dirname, "../..");
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf-8"));

function files(dir: string, accept: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".next")) continue;
    if (statSync(full).isDirectory()) files(full, accept, out);
    else if (accept.test(name)) out.push(full);
  }
  return out;
}

const sources = files(resolve(root, "frontend/src"), /\.(ts|tsx)$/).filter((f) => !f.includes("/data/"));
const docs = [resolve(root, "README.md"), resolve(root, "frontend/.env.example")];

describe("the deployed contract address", () => {
  const deployed: string = readJson("deployments/studio-next.json").contract_address;

  it("is the one the app uses, exactly as deployed (checksummed)", () => {
    expect(ARGUS_ADDRESS).toBe(deployed);
    expect(readJson("frontend/src/data/studio-next.json").contract_address).toBe(deployed);
  });

  it("is the only contract address in the UI, helpers and docs: no archived deployment leaks through", () => {
    const archived = files(resolve(root, "deployments"), /^studio-next\.v\d+\.json$/)
      .map((f) => String(readJson(`deployments/${f.split("/").pop()}`).contract_address))
      .filter((a) => a.toLowerCase() !== deployed.toLowerCase());
    expect(archived.length).toBeGreaterThan(0);
    for (const file of [...sources, ...docs]) {
      const text = readFileSync(file, "utf-8").toLowerCase();
      for (const old of archived) expect(text.includes(old.toLowerCase()), `${file} mentions the archived address ${old}`).toBe(false);
    }
  });

  it("is never hardcoded outside the one constant", () => {
    const offenders = sources.filter((f) => !f.endsWith("lib/networks.ts") && readFileSync(f, "utf-8").toLowerCase().includes(deployed.toLowerCase()));
    expect(offenders).toEqual([]);
  });
});

describe("explorer links", () => {
  it("point at the GenLayer Studio Next explorer", () => {
    expect(EXPLORER_URL).toBe("https://explorer-studio-next.genlayer.com");
  });

  it("are always built from EXPLORER_URL, never a literal host", () => {
    const literal = sources.filter((f) => !f.endsWith("contracts/chain.ts") && /https?:\/\/[^\s"'`]*explorer/i.test(readFileSync(f, "utf-8")));
    expect(literal).toEqual([]);
  });
});

describe("footer", () => {
  const renderFooter = () => render(<Footer />, { wrapper: withQuery() });

  it("links the active contract on the Studio Next explorer", () => {
    renderFooter();
    const link = screen.getByRole("link", { name: new RegExp(shortAddress(ARGUS_ADDRESS, 10, 4)) });
    expect(link).toHaveAttribute("href", `${EXPLORER_URL}/address/${ARGUS_ADDRESS}`);
    expect(link.getAttribute("href")).toContain("explorer-studio-next.genlayer.com/address/0x3f53bAA9");
  });

  it("shows the current test count and links the repository's tests", () => {
    renderFooter();
    const tests = screen.getByRole("link", { name: /test suite/i });
    expect(tests).toHaveTextContent(`Test Suite (${TEST_COUNTS.contract} Passed)`);
    expect(tests).toHaveAttribute("href", `${REPO_URL}/tree/main/tests`);
    expect(tests.getAttribute("title")).toBe(`${TEST_COUNTS.contract} contract tests (pytest) and ${TEST_COUNTS.frontend} frontend tests (Vitest)`);
  });

  it("points GitHub at the project repository and docs at GenLayer", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: /github/i })).toHaveAttribute("href", "https://github.com/moltaphet/ArgusGov");
    expect(screen.getByRole("link", { name: /genlayer docs/i })).toHaveAttribute("href", DOCS_URL);
  });

  it("keeps the old counts out of the rendered page", () => {
    const { container } = renderFooter();
    expect(container.textContent).not.toMatch(/\b(147|224|251|270|286)\b/);
  });
});

describe("test counts", () => {
  it("the About strip quotes the contract count", () => {
    render(<AboutSection />);
    expect(screen.getByText(`enforced in contract, checked by ${TEST_COUNTS.contract} tests`)).toBeInTheDocument();
  });

  it("no frontend copy quotes a stale count", () => {
    for (const file of sources.filter((f) => !f.endsWith("lib/project.ts"))) {
      expect(readFileSync(file, "utf-8"), file).not.toMatch(/\b(147|224|251|270|286)\s+(tests|passed)|\((147|224|251|270|286)\s+Passed\)/i);
    }
  });

  it("the README quotes the same counts", () => {
    const readme = readFileSync(resolve(root, "README.md"), "utf-8");
    const contract = [/(\d+) tests \(behaviour/, /pytest -q\s+# (\d+) passed/, /`pytest`: (\d+) passed/];
    const frontend = [/dashboard \((\d+) tests\)/, /(\d+) tests\): `cd frontend/];
    for (const re of contract) expect(Number(re.exec(readme)?.[1]), String(re)).toBe(TEST_COUNTS.contract);
    for (const re of frontend) expect(Number(re.exec(readme)?.[1]), String(re)).toBe(TEST_COUNTS.frontend);
  });
});
