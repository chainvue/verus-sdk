/**
 * The curated public surface of the offers module — Verus marketplace offers
 * (fully on-chain atomic swaps), built and signed offline.
 *
 * An offer is one half of an atomic swap: the maker signs the OFFERED asset's
 * output with SIGHASH_SINGLE|ANYONECANPAY (0x83), committing to a single WANTED
 * output; a taker adds their own inputs/outputs and signs SIGHASH_ALL, and the two
 * halves merge into one transaction. The OFFERED and WANTED assets may each be the
 * native coin, a token, or a VerusID — every combination is covered:
 *
 *   - Currency ↔ currency: `buildOfferFunding` + `buildOffer` (maker), `completeOffer`
 *     (taker). Handles native↔native, native↔token, token↔native, token↔token.
 *   - Sell a VerusID for currency: `buildSellIdentityOffer` + `completeSellIdentityOffer`.
 *   - Buy a VerusID with currency: `buildBuyIdentityOffer` + `completeBuyIdentityOffer`.
 *   - Swap a VerusID for a VerusID: `buildSwapIdentityOffer` + `completeSwapIdentityOffer`.
 *
 * The maker flows that offer a currency need a funding transaction first
 * (`buildOfferFunding` → broadcast → `buildOffer`); the identity-sell and swap
 * makers spend the identity's existing on-chain output directly, no funding tx.
 * These are also available on the `VerusSDK` facade (which injects the network);
 * this module is the standalone entry point for power users. The lower-level
 * fulfillment signers (`signOfferInput`, `signTakerInputs`) stay internal.
 */
export {
  // Currency-offer maker: fund the offered asset, then build the half-signed offer.
  buildOfferFunding,
  buildOffer,
} from './maker.js';
export {
  // Currency-offer taker: complete and sign the swap.
  completeOffer,
} from './taker.js';
export {
  // Identity-offer flows (sell / buy / swap), maker + taker halves.
  buildSellIdentityOffer,
  completeSellIdentityOffer,
  buildBuyIdentityOffer,
  completeBuyIdentityOffer,
  buildSwapIdentityOffer,
  completeSwapIdentityOffer,
} from './identity.js';

export type {
  FundedOutpoint,
  BuildOfferFundingParams,
  BuildOfferFundingResult,
  OfferWant,
  BuildOfferParams,
  BuildOfferResult,
} from './maker.js';
export type { CompleteOfferParams, CompleteOfferResult } from './taker.js';
export type {
  BuildSellIdentityOfferParams,
  CompleteSellIdentityOfferParams,
  CompleteSellIdentityOfferResult,
  BuildBuyIdentityOfferParams,
  CompleteBuyIdentityOfferParams,
  CompleteBuyIdentityOfferResult,
  BuildSwapIdentityOfferParams,
  CompleteSwapIdentityOfferParams,
  CompleteSwapIdentityOfferResult,
} from './identity.js';
