import { describe, it, expect } from 'vitest';
import {
  parseRAddress,
  parseIAddress,
  parseAddress,
  isIAddress,
  isRAddress,
} from '../src/core/brands.js';
import { InvalidAddressError } from '../src/errors.js';
import { NETWORK_CONFIG } from '../src/constants/index.js';

const R_ADDR = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';
const I_ADDR = NETWORK_CONFIG.testnet.chainId; // an i-address (version 0x66)

describe('core/brands', () => {
  it('parses a valid R-address and i-address', () => {
    expect(parseRAddress(R_ADDR)).toBe(R_ADDR);
    expect(parseIAddress(I_ADDR)).toBe(I_ADDR);
  });

  it('rejects an i-address where an R-address is required (and vice versa)', () => {
    expect(() => parseRAddress(I_ADDR)).toThrow(InvalidAddressError);
    expect(() => parseIAddress(R_ADDR)).toThrow(InvalidAddressError);
  });

  it('rejects non-base58check garbage', () => {
    expect(() => parseAddress('not-an-address!!!')).toThrow(InvalidAddressError);
  });

  it('parseAddress discriminates by version, and the narrowers agree', () => {
    const a = parseAddress(R_ADDR);
    const b = parseAddress(I_ADDR);
    expect(isRAddress(a)).toBe(true);
    expect(isIAddress(a)).toBe(false);
    expect(isIAddress(b)).toBe(true);
    expect(isRAddress(b)).toBe(false);
  });
});
