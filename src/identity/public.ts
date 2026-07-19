/**
 * The curated public surface of the identity module.
 *
 * `src/identity/index.ts` exports ~20 symbols, but most are internal building
 * blocks: script constructors (buildCommitmentScript, buildReservationScript,
 * identityPaymentScript, buildTokenChangeOutput, …), serializers, and version
 * asserts. They are `export`ed only so sibling modules (the assemblers, currency)
 * can import them, and several now take BRANDED parameter types that aren't part
 * of the public API — an external caller can't even type a valid call.
 *
 * Re-exporting the whole module (`export * as identity`) turned that internal
 * cross-module surface into an accidental public API: every internal refactor
 * risked a breaking change, and callers saw uncallable internals. This module is
 * the INTENTIONAL public subset — string-typed, useful standalone, and stable —
 * that `src/index.ts` exposes as the `identity` namespace instead.
 *
 * The main identity flows are also available on the `VerusSDK` facade; these are
 * the standalone entry points for power users assembling custom flows.
 */
export {
  // Deterministic salt for the two-step commitment flow.
  generateSalt,
  // name (+ optional i-address parent) -> identity i-address.
  deriveIdentityAddress,
  // Is this parent the VRSC root system (vs a sub-ID parent)?
  isVRSCParent,
  // Step 1: build the name-commitment data.
  prepareNameCommitment,
  // Registration fee split (issuer fee vs referral payouts).
  calculateRegistrationFees,
  // The identity flows (also on VerusSDK): commitment, registration, update.
  buildAndSignCommitment,
  buildAndSignRegistration,
  buildAndSignIdentityUpdate,
} from './index.js';
