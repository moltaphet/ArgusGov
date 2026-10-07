import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { deriveGovernorProposalId, descriptionHashOf, provenanceView } from "@/lib/provenance";
import { committedProposal, EVIL, GEN, TOKEN, transferCalldata } from "./helpers";

const GOVERNOR = "0x" + "c0".repeat(20);
const CALLDATA = transferCalldata(EVIL, 5_000n * GEN);
const DESC = descriptionHashOf("# Marketing grant\nFund Q3 marketing.");
const PID = deriveGovernorProposalId([TOKEN], [0n], [CALLDATA], DESC);

const verified = (over = {}) => committedProposal({
  daoProposalId: Number(PID % 2n ** 53n), calldatas: [CALLDATA],
  provenance: { status: "VERIFIED", governor: GOVERNOR, descriptionHash: DESC, binding: "0x" + "11".repeat(32), attestedAt: 5 }, ...over,
});

describe("canonical Governor proposal id", () => {
  it("is keccak256(abi.encode(targets, values, calldatas, descriptionHash)) and binds every field", () => {
    expect(PID).toBe(deriveGovernorProposalId([TOKEN], [0n], [CALLDATA], DESC));
    expect(deriveGovernorProposalId([EVIL], [0n], [CALLDATA], DESC)).not.toBe(PID);
    expect(deriveGovernorProposalId([TOKEN], [1n], [CALLDATA], DESC)).not.toBe(PID);
    expect(deriveGovernorProposalId([TOKEN], [0n], [transferCalldata(EVIL, 5_001n * GEN)], DESC)).not.toBe(PID);
    expect(deriveGovernorProposalId([TOKEN], [0n], [CALLDATA], descriptionHashOf("tampered"))).not.toBe(PID);
  });
});

describe("provenanceView", () => {
  it("reports an unattested commitment as unverified", () => {
    const v = provenanceView(committedProposal());
    expect(v.status).toBe("UNVERIFIED");
    expect(v.headline).toBe("PROVENANCE UNVERIFIED");
  });

  it("reports an orphan as having no on-chain origin", () => {
    const v = provenanceView(committedProposal({ provenance: { status: "ORPHAN", governor: GOVERNOR, descriptionHash: DESC, binding: "", attestedAt: 1 } }));
    expect(v.tone).toBe("crit");
    expect(v.headline).toContain("ORPHAN");
  });
});

describe("ProvenanceBadge", () => {
  it("shows VERIFIED ON-CHAIN ORIGIN with governor, chain id and description hash", () => {
    render(<ProvenanceBadge committed={verified()} />);
    expect(screen.getByText("VERIFIED ON-CHAIN ORIGIN")).toBeInTheDocument();
    expect(screen.getByText(/0xc0c0c0/i)).toBeInTheDocument();
    expect(screen.getByText("61997")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(DESC.slice(0, 10)))).toBeInTheDocument();
  });

  it("does not claim verification for an unattested proposal", () => {
    render(<ProvenanceBadge committed={committedProposal()} />);
    expect(screen.queryByText("VERIFIED ON-CHAIN ORIGIN")).not.toBeInTheDocument();
    expect(screen.getByText("PROVENANCE UNVERIFIED")).toBeInTheDocument();
  });

  it("flags a stored payload that no longer derives its id", () => {
    // daoProposalId is a JS number, so only small ids can be compared exactly: use a real small mismatch.
    const v = provenanceView(verified({ daoProposalId: 7 }));
    expect(v.idMatches).toBe(false);
  });
});

describe("About section", () => {
  it("presents the provenance and enforcement hardening flow", async () => {
    const { AboutSection } = await import("@/components/AboutSection");
    render(<AboutSection />);
    expect(screen.getByRole("heading", { name: /Protocol Hardening: Proposal Provenance & Execution Enforcement/ })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /Provenance to enforcement flow/ })).toHaveTextContent(/Execution-Enforcement Hook/);
  });
});
