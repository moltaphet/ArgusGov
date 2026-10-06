// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computePayloadHash } from "@/lib/payloadHash";
import { EVIL, GEN, TOKEN, transferCalldata } from "./helpers";

const A1 = "0x" + "a1".repeat(20);

// Reference values come from two independent implementations that agree with each other:
// Python eth_abi + eth_utils, and the contract's own pure-Python keccak running on the real
// GenLayer VM (the LIVE vector is the payload_hash that Studio Next stored on-chain).
describe("payload hash parity with the contract", () => {
  it("matches the commitment stored on Studio Next for the live demo proposal", () => {
    expect(computePayloadHash([TOKEN], [0n], [transferCalldata(EVIL, 9_999_999n * GEN)], "https://example.com"))
      .toBe("0x980acbf4687d1d5b832bba5209ecfa26e81a33e61345b2f9f611e18ed0fd04b3");
  });

  it.each([
    ["two actions with a value and an empty call", [TOKEN, A1], [0n, 3n * GEN], [transferCalldata(EVIL, 7n), "0x"], "https://forum.example-dao.org/t/42",
      "0xf5a95ea25dc486c2c8d78c78d9d9350b269d0c7807e573ff137b16cdd020668e"],
    ["a single empty call", [A1], [0n], ["0x"], "https://example.com",
      "0x16054d1d1a80ecbeee81096ece7355ba26edaa59d0ee4b24524c5b8e6cc22614"],
    ["max uint256 value and calldata that is not word-aligned", [TOKEN], [2n ** 256n - 1n], ["0x" + "ab".repeat(33)], "https://forum.example-dao.org/t/9",
      "0xbdbdd715f9d5c3280b30ad8997d8d2793c5480161e1469167868702d013dff19"],
  ])("matches the reference for %s", (_name, targets, values, calldatas, url, expected) => {
    expect(computePayloadHash(targets as string[], values as bigint[], calldatas as string[], url as string)).toBe(expected);
  });

  it("changes when any committed field changes", () => {
    const base: [string[], bigint[], string[], string] = [[TOKEN], [0n], [transferCalldata(EVIL, 1n)], "https://example.com"];
    const hashes = new Set([
      computePayloadHash(...base),
      computePayloadHash([A1], base[1], base[2], base[3]),
      computePayloadHash(base[0], [1n], base[2], base[3]),
      computePayloadHash(base[0], base[1], [transferCalldata(EVIL, 2n)], base[3]),
      computePayloadHash(base[0], base[1], base[2], "https://example.org"),
    ]);
    expect(hashes.size).toBe(5);
  });
});
