/**
 * Pay three recipients in one transaction, and see what the miner fee is.
 *
 * Verus does NOT price a transaction by its size: the daemon's mempool minimum
 * (GetMinRelayFeeByOutputs, VerusCoin src/pbaas/reserves.cpp:7906) is 10,000
 * satoshis per non-change OUTPUT. So one recipient costs 10,000 and three cost
 * 30,000 — while the transaction's byte count changes almost nothing.
 *
 * In your project:  import { VerusSDK, utils } from "@chainvue/verus-sdk";
 * Run here:         pnpm build && pnpm bundle && node examples/multi-recipient-send.cjs
 */
const { VerusSDK, utils, estimateMinerFee, NETWORK_CONFIG } = require("../dist/bundle.js");

async function main() {
  const sdk = new VerusSDK({ network: "testnet" });
  const systemId = NETWORK_CONFIG.testnet.chainId;

  const wif = VerusSDK.generateWif();
  const address = await VerusSDK.deriveAddress(wif);
  const script = utils.addressToScriptPubKey(address).toString("hex");

  const recipients = [address, address, address]; // three payments (to self, for a self-contained demo)

  const result = sdk.sendCurrency({
    wif,
    outputs: recipients.map((to) => ({ currency: systemId, satoshis: 1_000_000n, address: to })),
    utxos: [{ txid: "ab".repeat(32), outputIndex: 0, satoshis: 100_000_000n, script }],
    changeAddress: address,
    // Required. In real use pass `currentBlockHeight + DEFAULT_EXPIRY_DELTA`.
    expiryHeight: 0,
  });

  console.log("recipients:  ", recipients.length);
  console.log("txid:        ", result.txid);
  console.log("fee (sats):  ", result.fee.toString());
  console.log("size (bytes):", result.signedTx.length / 2);
  console.log("nativeChange:", result.nativeChange.toString());

  if (result.fee !== 30_000n) throw new Error(`expected a 30000-sat fee for 3 recipients, got ${result.fee}`);

  // The same number, without building anything: the fee is a pure function of
  // the output scripts. (Change is excluded — the daemon does not charge for it.)
  const quoted = estimateMinerFee(recipients.map(() => utils.addressToScriptPubKey(address)));
  console.log("quoted ahead of time:", quoted.toString(), "→ matches:", quoted === result.fee);

  const summary = utils.summarizeSignedTransaction(result.signedTx, "testnet");
  if (summary.txid !== result.txid) throw new Error("txid mismatch after decode");
  console.log("decoded txid matches:", summary.txid === result.txid);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
