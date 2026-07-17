/**
 * Keys & addresses — generate a WIF, derive its R-address, derive an identity
 * i-address, and validate both. All offline.
 *
 * In your project:  import { VerusSDK } from "@chainvue/verus-sdk";
 * Run here:         pnpm build && pnpm bundle && node examples/keygen-and-address.cjs
 */
const { VerusSDK } = require("../dist/bundle.js");

async function main() {
  // A throwaway key from the platform CSPRNG. Never log or commit a real one.
  const wif = VerusSDK.generateWif();
  console.log("WIF valid:            ", VerusSDK.validateWif(wif).valid);

  const address = await VerusSDK.deriveAddress(wif);
  console.log("R-address:            ", address);
  console.log("R-address valid:      ", VerusSDK.validateAddress(address).valid);

  // Identity i-addresses are deterministic from the name (+ optional parent),
  // so you can compute one before the identity is registered.
  console.log("i-address for alice@: ", VerusSDK.deriveIdentityAddress("alice"));
  console.log("i-address for sub.alice@:", VerusSDK.deriveIdentityAddress("sub", VerusSDK.deriveIdentityAddress("alice")));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
