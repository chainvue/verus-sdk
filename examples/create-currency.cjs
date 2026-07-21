/**
 * Build currency-definition output scripts — token, fractional basket, and NFT —
 * fully offline, byte-equivalent to what the daemon's `definecurrency` produces.
 *
 * In your project:  import { VerusSDK, CURRENCY_OPTION } from "@chainvue/verus-sdk";
 * Run here:         pnpm build && pnpm bundle && node examples/create-currency.cjs
 *
 * A currency is defined under a VerusID of the same name. The definition SCRIPT
 * below is pure serialization (no live data). The full broadcastable launch —
 * `sdk.buildCurrencyLaunchTransaction({ … })` — additionally needs that identity
 * (from `getidentity`), its controlling UTXO, funding UTXOs, and the tip height.
 * See docs/currency.md.
 */
const { VerusSDK, CURRENCY_OPTION } = require("../dist/bundle.js");

function main() {
  const sdk = new VerusSDK({ network: "testnet" });

  const VRSCTEST = "iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq"; // chain root = systemId
  const SECOND = "iDMAoXEjZLkpofokBGsVwen7YEwo1iujMQ"; // an existing reserve token
  const myId = VerusSDK.deriveIdentityAddress("mytoken", VRSCTEST); // defining identity

  // A simple centralized token (issuer mints/burns via proofProtocol 2).
  const token = sdk.buildCurrencyDefinitionScript({
    name: "mytoken",
    parent: VRSCTEST,
    options: CURRENCY_OPTION.TOKEN, // 0x20
    proofProtocol: 2,
    startBlock: 3_000_000,
    preAllocations: [{ address: myId, amount: 1_000_000_00000000n }], // 1,000,000 minted at launch
  });

  // A fractional reserve basket — must include the native currency; weights are
  // relative and normalized to sum to 1e8, each ≥ 5%.
  const basket = sdk.buildCurrencyDefinitionScript({
    name: "mybasket",
    parent: VRSCTEST,
    options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL, // 0x21
    proofProtocol: 1,
    startBlock: 3_000_000,
    currencies: [VRSCTEST, SECOND],
    weights: [50_000000n, 50_000000n],
    initialSupply: 100_000_00000000n,
  });

  // An NFT: a single-satoshi tokenized ID control (native currency auto-mapped).
  const nft = sdk.buildCurrencyDefinitionScript({
    name: "mynft",
    parent: VRSCTEST,
    options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.SINGLECURRENCY | CURRENCY_OPTION.NFT_TOKEN, // 0x860
    proofProtocol: 1,
    startBlock: 3_000_000,
    preAllocations: [{ address: VerusSDK.deriveIdentityAddress("mynft", VRSCTEST), amount: 1n }],
  });

  console.log("token  definition script:", token.slice(0, 48) + "… (" + token.length / 2 + " bytes)");
  console.log("basket definition script:", basket.slice(0, 48) + "… (" + basket.length / 2 + " bytes)");
  console.log("nft    definition script:", nft.slice(0, 48) + "… (" + nft.length / 2 + " bytes)");
}

main();
