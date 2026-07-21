/**
 * Reserve-transfer output builder — the output that converts or *pre*converts a
 * reserve currency into a fractional/launching currency. A pre-convert is how you
 * "invest" in a currency during its pre-launch window: you send a reserve (e.g.
 * native VRSCTEST) to the launching currency and receive its fractional currency
 * when it launches.
 *
 * The wire format is `verus-typescript-primitives`' `ReserveTransfer` (verified to
 * round-trip and rebuild live daemon output byte-for-byte, single-value mode)
 * wrapped in the EVAL_RESERVE_TRANSFER (=8) CryptoCondition output, whose
 * destination is the reserve-transfer contract's KeyID (like the import output,
 * TYPE_PKH not TYPE_PK). Byte-locked against a live `sendcurrency ...
 * returntxtemplate` reference — see test/currency-reserve-transfer.test.ts.
 *
 * Scope: sending the chain's native reserve into a fractional currency (the
 * common "invest at launch" path). The native output value is amount + fee.
 */
import BN from 'bn.js';
import { ReserveTransfer, TransferDestination, CurrencyValueMap } from '../fork/boundary.js';
import { TransactionBuildError } from '../errors.js';
import { parseIAddress } from '../core/brands.js';
import { wrapCcOutput } from './wire.js';

const EVAL_RESERVE_TRANSFER = 8;
// Hash160 of the EVAL_RESERVE_TRANSFER contract pubkey — the output's KeyID
// destination (chain-independent, `src/cc/CCcustom.cpp`).
const RESERVE_TRANSFER_KEYHASH = Buffer.from('cb8a0f7f651b484a81e2312c3438deb601e27368', 'hex');

// The daemon's minimum reserve-transfer fee (0.0002 native; GetTransactionTransferFee).
const MIN_TRANSFER_FEE = 20_000n;

// ReserveTransfer flag bits.
const RT_VALID = 1;
const RT_CONVERT = 2;
const RT_PRECONVERT = 4;

// TransferDestination: DEST_ID with an auxiliary destination — the convention
// `sendcurrency` emits (the aux dest mirrors the recipient).
const DEST_ID = 4;
const FLAG_DEST_AUX = 0x40;

export interface ReserveTransferParams {
  /** Reserve currency being sent — the chain's native currency i-address. */
  sourceCurrency: string;
  /** Amount of `sourceCurrency` in satoshis. */
  amount: bigint;
  /** The fractional/launching currency to (pre)convert into. */
  destCurrency: string;
  /** i-address that receives the converted currency. */
  recipient: string;
  /**
   * Refund/return i-address carried as the transfer's auxiliary destination — the
   * daemon sets this to the sending address. Defaults to `recipient`.
   */
  refundAddress?: string;
  /** Conversion fee in satoshis (fee currency defaults to `sourceCurrency`). */
  feeAmount: bigint;
  /** Fee currency i-address. Defaults to `sourceCurrency`. */
  feeCurrency?: string;
  /**
   * `true` for a pre-convert (only valid before the currency's start block —
   * "invest at launch"), `false` for a market convert into a live currency.
   */
  preconvert?: boolean;
}

/** A reserve-transfer output: its scriptPubKey hex and native satoshi value (amount + fee). */
export interface ReserveTransferBuildResult {
  script: string;
  value: bigint;
}

/**
 * Build the EVAL_RESERVE_TRANSFER output that (pre)converts native reserve into a
 * fractional currency — byte-equivalent to what `sendcurrency` produces. Returns
 * the output script and the native value it must carry (amount + fee).
 */
export function buildReserveTransferOutput(params: ReserveTransferParams): ReserveTransferBuildResult {
  if (params.amount <= 0n) {
    throw new TransactionBuildError('amount must be positive');
  }
  // The daemon's minimum transfer fee (GetTransactionTransferFee, pbaas.cpp): a
  // reserve transfer paying less is rejected. The exact fee for a given amount is
  // computed by the node — query it (e.g. `sendcurrency … returntxtemplate`) and
  // pass it here; this only guards the floor.
  if (params.feeAmount < MIN_TRANSFER_FEE) {
    throw new TransactionBuildError(`feeAmount must be at least ${MIN_TRANSFER_FEE} (the daemon's minimum transfer fee), got ${params.feeAmount}`);
  }
  // Every address MUST be a currency/identity i-address. The transfer destination
  // is encoded as DEST_ID, so an R-address recipient would silently become an
  // identity id equal to that hash160 — almost certainly a nonexistent identity —
  // and the converted funds would be unrecoverable. parseIAddress rejects a
  // non-i-address (wrong version byte or bad checksum) fail-closed. The currency
  // ids get the same check so a wrong-typed address can't become a wrong currency.
  parseIAddress(params.sourceCurrency, 'sourceCurrency');
  parseIAddress(params.destCurrency, 'destCurrency');
  parseIAddress(params.recipient, 'recipient');
  if (params.refundAddress !== undefined) {
    parseIAddress(params.refundAddress, 'refundAddress');
  }
  const feeCurrency = params.feeCurrency ?? params.sourceCurrency;
  parseIAddress(feeCurrency, 'feeCurrency');
  // Native-reserve scope: the output value is amount + fee in a single currency,
  // so a different fee currency would make that value wrong. Require them equal.
  if (feeCurrency !== params.sourceCurrency) {
    throw new TransactionBuildError('feeCurrency must equal sourceCurrency (this builder handles native-reserve transfers only)');
  }

  const flags = RT_VALID | RT_CONVERT | (params.preconvert ? RT_PRECONVERT : 0);

  const transfer = new ReserveTransfer({
    // Single-value mode (multivalue:false) — the daemon's encoding for a
    // single-currency transfer: currency id + VARINT amount, no count prefix.
    values: new CurrencyValueMap({
      value_map: new Map([[params.sourceCurrency, new BN(params.amount.toString())]]),
      multivalue: false,
    }),
    version: new BN(1),
    flags: new BN(flags),
    fee_currency_id: feeCurrency,
    fee_amount: new BN(params.feeAmount.toString()),
    transfer_destination: TransferDestination.fromJson({
      type: DEST_ID | FLAG_DEST_AUX,
      address: params.recipient,
      auxdests: [{ type: DEST_ID, address: params.refundAddress ?? params.recipient }],
    }),
    dest_currency_id: params.destCurrency,
  });

  const script = wrapCcOutput(EVAL_RESERVE_TRANSFER, [transfer.toBuffer()], {
    kind: 'keyid',
    hash: RESERVE_TRANSFER_KEYHASH,
  }).toString('hex');

  // For a native-reserve transfer the output carries the amount plus the fee.
  return { script, value: params.amount + params.feeAmount };
}
