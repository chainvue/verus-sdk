/**
 * VerusID message signing — sign a message, then verify the signature. Offline.
 *
 * In your project:  import { VerusSDK } from "@chainvue/verus-sdk";
 * Run here:         pnpm build && pnpm bundle && node examples/sign-verify-message.cjs
 *
 * Note: in real use the signing key must control the identity you name. Here we
 * derive a self-consistent pair purely to show the sign → verify roundtrip.
 */
const { VerusSDK } = require("../dist/bundle.js");

const sdk = new VerusSDK({ network: "testnet" });
const wif = VerusSDK.generateWif();
const identityAddress = VerusSDK.deriveIdentityAddress("example");
const message = "hello from @chainvue/verus-sdk";

const signed = sdk.signMessage({ wif, message, identityAddress });
console.log("signature:      ", signed.signature.slice(0, 24) + "…");
console.log("signingAddress: ", signed.signingAddress);
console.log("blockHeight:    ", signed.blockHeight);

const verdict = sdk.verifyMessage({
  message,
  signature: signed.signature,
  signingAddress: signed.signingAddress,
  identityAddress,
  blockHeight: signed.blockHeight,
});
console.log("verify valid:   ", verdict.valid);
