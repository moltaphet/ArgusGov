// genlayer-js and wallet layers JSON-serialise request envelopes that carry
// bigints (u256 ids, atto-scale values). Teach BigInt to serialise losslessly.
if (typeof BigInt !== "undefined") {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (typeof proto.toJSON !== "function") {
    proto.toJSON = function (this: bigint): string {
      return this.toString();
    };
  }
}
export {};
