/**
 * Branded domain types + parse-don't-validate constructors.
 *
 * The address-version-laundering bug class (KeyID/IdentityID.fromAddress and
 * fromBase58Check discard the version byte) was defended by scattering
 * assertAddressVersion at each call site. Brands move that guarantee into the
 * type system: once an internal function's signature demands an `IAddress`, a
 * raw `string` (or an `RAddress`) cannot be passed — the compiler rejects it,
 * and a forgotten check is a build error instead of a live-testnet discovery.
 *
 * Brands are structural subtypes of `string`, so a value already flows into the
 * fork's constructors with zero casts; the only way to MINT one is through a
 * parser here, which validates the version byte. No fork imports (uses bs58check
 * directly), so this stays at the dependency-free core.
 */
import bs58check from 'bs58check';
import { PUBKEY_HASH_PREFIX, I_ADDR_VERSION } from '../constants/index.js';
import { InvalidAddressError } from '../errors.js';

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Transparent R-address (version 0x3c, pubkey-hash). */
export type RAddress = Brand<string, 'RAddress'>;
/** Identity i-address (version 0x66) — identities AND currency ids (offline-indistinguishable). */
export type IAddress = Brand<string, 'IAddress'>;
/** P2SH address (version 0x55). */
export type P2shAddress = Brand<string, 'P2shAddress'>;
/** Any parsed base58check address of a known kind. */
export type Address = RAddress | IAddress | P2shAddress;

/**
 * Documentation alias: a currency id IS an i-address. There is deliberately no
 * separate `CurrencyId` brand — an offline SDK cannot tell an i-address naming a
 * currency from one naming an identity, so a distinct brand would be a lie the
 * type system can't check and would force unsafe casts.
 */
export type CurrencyId = IAddress;

const P2SH_VERSION = 0x55;

/** Decode a base58check string to its version byte + 20-byte hash, or throw typed. */
function decode(s: string, label: string): { version: number } {
  let decoded: Uint8Array;
  try {
    decoded = bs58check.decode(s);
  } catch (err) {
    throw new InvalidAddressError(String(s), `${label} is not valid base58check: ${(err as Error).message}`);
  }
  if (decoded.length !== 21) {
    throw new InvalidAddressError(String(s), `${label} must decode to a 1-byte version + 20-byte hash, got ${decoded.length} bytes`);
  }
  return { version: decoded[0] as number };
}

/** Parse a transparent R-address; throws InvalidAddressError otherwise. */
export function parseRAddress(s: string, label = 'address'): RAddress {
  const { version } = decode(s, label);
  if (version !== PUBKEY_HASH_PREFIX) {
    throw new InvalidAddressError(s, `${label} must be an R-address (version ${PUBKEY_HASH_PREFIX}), got version ${version}`);
  }
  return s as RAddress;
}

/** Parse an identity/currency i-address; throws InvalidAddressError otherwise. */
export function parseIAddress(s: string, label = 'address'): IAddress {
  const { version } = decode(s, label);
  if (version !== I_ADDR_VERSION) {
    throw new InvalidAddressError(s, `${label} must be an identity i-address (version ${I_ADDR_VERSION}), got version ${version}`);
  }
  return s as IAddress;
}

/** Parse any supported address into the discriminated union; throws otherwise. */
export function parseAddress(s: string, label = 'address'): Address {
  const { version } = decode(s, label);
  switch (version) {
    case PUBKEY_HASH_PREFIX:
      return s as RAddress;
    case I_ADDR_VERSION:
      return s as IAddress;
    case P2SH_VERSION:
      return s as P2shAddress;
    default:
      throw new InvalidAddressError(s, `${label} has unsupported version byte ${version}`);
  }
}

/** Narrow an Address to an i-address by its version byte (replaces startsWith('i')). */
export function isIAddress(a: Address): a is IAddress {
  return decode(a, 'address').version === I_ADDR_VERSION;
}

/** Narrow an Address to an R-address by its version byte. */
export function isRAddress(a: Address): a is RAddress {
  return decode(a, 'address').version === PUBKEY_HASH_PREFIX;
}
