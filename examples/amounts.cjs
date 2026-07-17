/**
 * Amounts — bigint satoshis end to end, converted only at the edges.
 *
 * In your project:  import { parseSats, toCoins, toSafeNumber } from "@chainvue/verus-sdk";
 * Run here:         pnpm build && pnpm bundle && node examples/amounts.cjs
 */
const { parseSats, toCoins, toSafeNumber, SATS_PER_COIN } = require("../dist/bundle.js");

// Decimal string in → bigint satoshis. Pass the raw user text, never a float.
console.log("parseSats('1.5')          =", parseSats("1.5").toString(), "sats");
console.log("SATS_PER_COIN             =", SATS_PER_COIN.toString());

// bigint satoshis → exact decimal string for display.
console.log("toCoins(150_000_000n)     =", toCoins(150_000_000n), "VRSC");

// The single audited crossing into the float64-modelled signer.
console.log("toSafeNumber(90_000_000n) =", toSafeNumber(90_000_000n));
try {
  toSafeNumber(2n ** 60n); // above 2^53 sats
} catch (err) {
  console.log("toSafeNumber(2^60)        → throws", err.name, "(refuses a lossy amount)");
}
