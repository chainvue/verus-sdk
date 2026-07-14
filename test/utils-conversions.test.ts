import { describe, it, expect } from 'vitest';
import { toSatoshis, parseSats, toCoins } from '../src/utils/index';

describe('toSatoshis', () => {
  it('converts whole coins', () => {
    expect(toSatoshis('1')).toBe(100000000n);
    expect(toSatoshis('100')).toBe(10000000000n);
  });

  it('converts fractional coins', () => {
    expect(toSatoshis('0.5')).toBe(50000000n);
    expect(toSatoshis('0.00000001')).toBe(1n);
  });

  it('is exact for decimals that are not float-representable', () => {
    // 0.1 + 0.2 !== 0.3 as JS numbers — the string API has no such artifact
    expect(toSatoshis('0.3')).toBe(30000000n);
  });

  it('handles zero', () => {
    expect(toSatoshis('0')).toBe(0n);
  });
});

describe('parseSats', () => {
  it('is the same conversion as toSatoshis', () => {
    expect(parseSats('1')).toBe(100000000n);
    expect(parseSats('42.12345678')).toBe(toSatoshis('42.12345678'));
  });
});

describe('toCoins', () => {
  it('converts whole satoshis', () => {
    expect(toCoins(100000000n)).toBe('1');
    expect(toCoins(10000000000n)).toBe('100');
  });

  it('converts fractional satoshis', () => {
    expect(toCoins(50000000n)).toBe('0.5');
    expect(toCoins(1n)).toBe('0.00000001');
  });

  it('handles zero', () => {
    expect(toCoins(0n)).toBe('0');
  });

  it('roundtrips with toSatoshis', () => {
    expect(toCoins(toSatoshis('42.12345678'))).toBe('42.12345678');
  });
});
