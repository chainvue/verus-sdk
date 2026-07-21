/**
 * Reserve-transfer output, byte-locked against a live VRSCTEST reference.
 *
 * The reference is a `sendcurrency ... returntxtemplate` output that converts
 * 1.0 VRSCTEST into the "bankroll" fractional basket (i3zeob…) for recipient
 * i4saPv8… — the daemon returns the exact output the wallet would broadcast, with
 * no inputs. A pre-convert is the same structure with the PRECONVERT flag set,
 * so this locks the serialization, the CryptoCondition wrapper (EVAL_RESERVE_TRANSFER
 * to the contract KeyID), the single-value amount encoding, the fee, and the
 * DEST_ID+aux destination the daemon emits.
 */
import { describe, it, expect } from 'vitest';
import { buildReserveTransferOutput } from '../src/currency/reserveTransfer.js';
import { TransactionBuildError } from '../src/errors.js';

const VRSCTEST = 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq';
const BANKROLL = 'i3zeobcYAJt6rkteDehA3UKnw4HydPunwR';
const RECIPIENT = 'i4saPv8g6LPx7gmrZ37gX7ghinVv8JEATr';

const CONVERT_REFERENCE =
  '1a040300010114cb8a0f7f651b484a81e2312c3438deb601e27368cc4c8f040308010114cb8a0f7f651b484a81e2312c3438deb601e273684c7301a6ef9ea235635e328124ff3429db9f9e91b64e2daed6c10003a6ef9ea235635e328124ff3429db9f9e91b64e2d809b2a44140f542a851b1d74e4f391d3f4843bbd6b2bdc1930011604140f542a851b1d74e4f391d3f4843bbd6b2bdc193005b2a1c3ea5756e3dc305f16166ffabdb66785c375';

describe('buildReserveTransferOutput — byte-locked against live sendcurrency', () => {
  it('reproduces a native → fractional convert output', () => {
    const r = buildReserveTransferOutput({
      sourceCurrency: VRSCTEST,
      amount: 100_000_000n, // 1.0
      destCurrency: BANKROLL,
      recipient: RECIPIENT,
      feeAmount: 20_010n, // 0.0002001, the daemon's computed conversion fee
      preconvert: false,
    });
    expect(r.script).toBe(CONVERT_REFERENCE);
    expect(r.value).toBe(100_020_010n); // amount + fee
  });

  it('sets the PRECONVERT flag for a pre-launch investment', () => {
    // The convert reference has flags byte 0x03 (VALID|CONVERT); pre-convert adds
    // PRECONVERT (0x04) → 0x07. Everything else is identical, so a byte diff
    // isolates exactly the flag change.
    const convert = buildReserveTransferOutput({
      sourceCurrency: VRSCTEST, amount: 100_000_000n, destCurrency: BANKROLL,
      recipient: RECIPIENT, feeAmount: 20_010n, preconvert: false,
    });
    const preconvert = buildReserveTransferOutput({
      sourceCurrency: VRSCTEST, amount: 100_000_000n, destCurrency: BANKROLL,
      recipient: RECIPIENT, feeAmount: 20_010n, preconvert: true,
    });
    // The two scripts differ only in the reserve-transfer flags byte.
    const diffs = [...convert.script].filter((ch, i) => ch !== preconvert.script[i]).length;
    expect(diffs).toBe(1);
    expect(preconvert.script).toContain('07a6ef9ea2'); // flags 0x07 before the fee currency id
  });

  it('reproduces a live pre-convert into a launching currency (distinct recipient + refund)', () => {
    // Byte-locked against a live `sendcurrency ... preconvert:true returntxtemplate`
    // reference: 10 VRSCTEST pre-converted into the launching basket sdkpredelta
    // (iAeFQsyq…), recipient sdkcuralpha (i7UCaJk…), refund/aux the sender kmerg
    // (i4saPv8…). Exercises the PRECONVERT flag (0x07) and a refund address that
    // differs from the recipient.
    const r = buildReserveTransferOutput({
      sourceCurrency: VRSCTEST,
      amount: 1_000_000_000n, // 10.0
      destCurrency: 'iAeFQsyqdqMGyytp2PQ881i4SMyEG5At52',
      recipient: 'i7UCaJkKRFXBCK4S1AMrkfKTnPwdLc7dV7',
      refundAddress: 'i4saPv8g6LPx7gmrZ37gX7ghinVv8JEATr',
      feeAmount: 20_000n,
      preconvert: true,
    });
    expect(r.script).toBe(
      '1a040300010114cb8a0f7f651b484a81e2312c3438deb601e27368cc4c90040308010114cb8a0f7f651b484a81e2312c3438deb601e273684c7401a6ef9ea235635e328124ff3429db9f9e91b64e2d82dbea930007a6ef9ea235635e328124ff3429db9f9e91b64e2d809b2044142bd0c2dcf49d034269ad0cd786c01bdd4bc2f9d6011604140f542a851b1d74e4f391d3f4843bbd6b2bdc19304e9faab01ffaf4e02858fcb17752e00171c34ed975',
    );
    expect(r.value).toBe(1_000_020_000n);
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      buildReserveTransferOutput({ sourceCurrency: VRSCTEST, amount: 0n, destCurrency: BANKROLL, recipient: RECIPIENT, feeAmount: 20_010n }),
    ).toThrow(TransactionBuildError);
  });

  // The destination is encoded as DEST_ID; an R-address would silently become an
  // identity id and the funds would be unrecoverable. All addresses must be i-addresses.
  const R_ADDRESS = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';
  const ok = { sourceCurrency: VRSCTEST, amount: 100_000_000n, destCurrency: BANKROLL, recipient: RECIPIENT, feeAmount: 20_010n };

  it('rejects an R-address recipient (would misroute funds to a nonexistent identity)', () => {
    expect(() => buildReserveTransferOutput({ ...ok, recipient: R_ADDRESS })).toThrow(/recipient/);
  });

  it('rejects an R-address refund address', () => {
    expect(() => buildReserveTransferOutput({ ...ok, refundAddress: R_ADDRESS })).toThrow(/refundAddress/);
  });

  it('rejects a non-i-address source/dest currency', () => {
    expect(() => buildReserveTransferOutput({ ...ok, sourceCurrency: R_ADDRESS })).toThrow(/sourceCurrency/);
    expect(() => buildReserveTransferOutput({ ...ok, destCurrency: R_ADDRESS })).toThrow(/destCurrency/);
  });

  it('rejects a fee currency that differs from the source (native scope)', () => {
    expect(() => buildReserveTransferOutput({ ...ok, feeCurrency: BANKROLL })).toThrow(/feeCurrency must equal sourceCurrency/);
  });

  it('rejects a fee below the daemon minimum', () => {
    expect(() => buildReserveTransferOutput({ ...ok, feeAmount: 19_999n })).toThrow(/at least 20000/);
    expect(buildReserveTransferOutput({ ...ok, feeAmount: 20_000n }).value).toBe(ok.amount + 20_000n);
  });
});
