import { describe, it, expect } from 'vitest';
import { toSatoshis, toCoins } from '../src/utils/index';

describe('toSatoshis', () => {
  it('converts whole coins', () => {
    expect(toSatoshis(1)).toBe(100000000);
    expect(toSatoshis(100)).toBe(10000000000);
  });

  it('converts fractional coins', () => {
    expect(toSatoshis(0.5)).toBe(50000000);
    expect(toSatoshis(0.00000001)).toBe(1);
  });

  it('rounds to avoid floating point issues', () => {
    expect(toSatoshis(0.1 + 0.2)).toBe(30000000);
  });

  it('handles zero', () => {
    expect(toSatoshis(0)).toBe(0);
  });
});

describe('toCoins', () => {
  it('converts whole satoshis', () => {
    expect(toCoins(100000000)).toBe(1);
    expect(toCoins(10000000000)).toBe(100);
  });

  it('converts fractional satoshis', () => {
    expect(toCoins(50000000)).toBe(0.5);
    expect(toCoins(1)).toBe(0.00000001);
  });

  it('handles zero', () => {
    expect(toCoins(0)).toBe(0);
  });

  it('roundtrips with toSatoshis', () => {
    expect(toCoins(toSatoshis(42.12345678))).toBeCloseTo(42.12345678, 8);
  });
});
