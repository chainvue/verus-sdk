/**
 * Typed error classes for the Verus TypeScript SDK
 *
 * Provides structured errors with machine-readable codes and
 * contextual data for callers to handle programmatically.
 */

/** Base error class for all SDK errors */
export class VerusError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'VerusError';
    this.code = code;
  }
}

/** Thrown when UTXOs cannot cover the required amount */
export class InsufficientFundsError extends VerusError {
  readonly required: bigint;
  readonly available: bigint;
  readonly currency: string;

  constructor(required: bigint, available: bigint, currency: string = 'VRSC') {
    const shortfall = required - available;
    super(
      'INSUFFICIENT_FUNDS',
      `Insufficient ${currency} balance. Need ${shortfall} more satoshis (required: ${required}, available: ${available}).`,
    );
    this.name = 'InsufficientFundsError';
    this.required = required;
    this.available = available;
    this.currency = currency;
  }
}

/** Thrown when a WIF key is missing, empty, or malformed */
export class InvalidWifError extends VerusError {
  constructor(detail?: string) {
    super('INVALID_WIF', detail ? `Invalid WIF: ${detail}` : 'Invalid or missing WIF key.');
    this.name = 'InvalidWifError';
  }
}

/** Thrown when an address fails format validation */
export class InvalidAddressError extends VerusError {
  readonly address: string;

  constructor(address: string, detail?: string) {
    super(
      'INVALID_ADDRESS',
      detail
        ? `Invalid address "${address}": ${detail}`
        : `Invalid address: "${address}"`,
    );
    this.name = 'InvalidAddressError';
    this.address = address;
  }
}

/** Thrown when an identity name fails validation */
export class InvalidNameError extends VerusError {
  readonly identityName: string;

  constructor(identityName: string, detail?: string) {
    super(
      'INVALID_NAME',
      detail
        ? `Invalid identity name "${identityName}": ${detail}`
        : `Invalid identity name: "${identityName}". Must be 1-64 characters: a-z, 0-9, _, -`,
    );
    this.name = 'InvalidNameError';
    this.identityName = identityName;
  }
}

/** Thrown when transaction construction fails for structural reasons */
export class TransactionBuildError extends VerusError {
  constructor(detail: string) {
    super('TX_BUILD_ERROR', `Transaction build failed: ${detail}`);
    this.name = 'TransactionBuildError';
  }
}

/** Thrown when a money amount is malformed or out of range */
export class InvalidAmountError extends VerusError {
  readonly value: string;

  constructor(value: string, detail?: string) {
    super(
      'INVALID_AMOUNT',
      detail
        ? `Invalid amount "${value}": ${detail}`
        : `Invalid amount: "${value}". Expected a non-negative decimal string with at most 8 fraction digits.`,
    );
    this.name = 'InvalidAmountError';
    this.value = value;
  }
}
