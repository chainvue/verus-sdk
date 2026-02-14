/**
 * Address format detection utilities
 *
 * Simple format checks for input routing (send forms, address fields).
 * For full base58check validation, use keys.validateAddress().
 */

export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Check if input looks like a Verus R-address */
export function isRAddress(input: string): boolean {
  return input.startsWith('R') && input.length >= 26 && input.length <= 36 && BASE58_RE.test(input);
}

/** Check if input looks like a Verus i-address */
export function isIAddress(input: string): boolean {
  return input.startsWith('i') && input.length >= 26 && input.length <= 36 && BASE58_RE.test(input);
}

/** Check if input looks like any Verus address (R or i) */
export function isVerusAddress(input: string): boolean {
  return isRAddress(input) || isIAddress(input);
}

/** Check if input looks like an identity name (not an address) */
export function isIdentityName(input: string): boolean {
  if (!input || isVerusAddress(input)) return false;
  return input.endsWith('@') || !BASE58_RE.test(input) || input.length < 26;
}
