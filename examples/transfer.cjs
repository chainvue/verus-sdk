/**
 * Build and sign a native VRSC transfer — fully offline — then decode the
 * signed bytes back to confirm what you'd broadcast.
 *
 * In your project:  import { VerusSDK, utils } from "@chainvue/verus-sdk";
 * Run here:         pnpm build && pnpm bundle && node examples/transfer.cjs
 *
 * The UTXO here is synthetic. In practice you fetch spendable outputs from a
 * daemon (e.g. @chainvue/verus-rpc `getAddressUtxos`) and broadcast signedTx
 * with `sendRawTransaction`.
 */
const { VerusSDK, utils } = require("../dist/bundle.js");

async function main() {
  const sdk = new VerusSDK({ network: "testnet" });

  const wif = VerusSDK.generateWif();
  const address = await VerusSDK.deriveAddress(wif);
  const script = utils.addressToScriptPubKey(address).toString("hex");

  const result = sdk.transfer({
    wif,
    to: address, // send to self for a self-contained demo
    amount: 90_000_000n, // 0.9 VRSC
    utxos: [{ txid: "ab".repeat(32), outputIndex: 0, satoshis: 100_000_000n, script }],
    changeAddress: address,
    // Required. In real use pass `currentBlockHeight + DEFAULT_EXPIRY_DELTA`
    // (the SDK is offline and can't read the tip); 0 means never expires.
    expiryHeight: 0,
  });

  console.log("txid:        ", result.txid);
  console.log("fee (sats):  ", result.fee.toString());
  console.log("nativeChange:", result.nativeChange.toString());
  console.log("signedTx:    ", result.signedTx.slice(0, 64) + "…");

  // Decode the signed bytes back — a pre-broadcast sanity check.
  const summary = utils.summarizeSignedTransaction(result.signedTx, "testnet");
  if (summary.txid !== result.txid) throw new Error("txid mismatch after decode");
  console.log("decoded txid matches:", summary.txid === result.txid);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
