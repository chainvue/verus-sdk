import { describe, it, expect } from 'vitest';
import { classifyCurrency, CURRENCY_TYPE_ORDER } from '../src/currency/classify';
import type { CurrencyType } from '../src/currency/classify';

describe('classifyCurrency', () => {
  it('classifies native currency (systemid === currencyid)', () => {
    expect(classifyCurrency({
      systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
      currencyid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
      options: 0x21,
    })).toBe('native');
  });

  it('classifies bridge (0x200)', () => {
    expect(classifyCurrency({
      systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
      currencyid: 'iBridgeXXXXXXXXXXXXXXXXXXXXXXXX',
      options: 0x200,
    })).toBe('bridge');
  });

  it('classifies gateway (0x80)', () => {
    expect(classifyCurrency({
      systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
      currencyid: 'iGatewayXXXXXXXXXXXXXXXXXXXXXXX',
      options: 0x80,
    })).toBe('gateway');
  });

  it('classifies liquidity pool (0x01 + currencies)', () => {
    expect(classifyCurrency({
      systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
      currencyid: 'iPoolXXXXXXXXXXXXXXXXXXXXXXXXXX',
      options: 0x01,
      currencies: { 'iA': 1, 'iB': 1 },
    })).toBe('liquidity_pool');
  });

  it('classifies nft (0x800)', () => {
    expect(classifyCurrency({
      systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
      currencyid: 'iNftXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      options: 0x800,
    })).toBe('nft');
  });

  it('defaults to token', () => {
    expect(classifyCurrency({
      systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
      currencyid: 'iTokenXXXXXXXXXXXXXXXXXXXXXXXXX',
      options: 0,
    })).toBe('token');
  });

  it('handles missing options field', () => {
    expect(classifyCurrency({
      systemid: 'iA',
      currencyid: 'iB',
    })).toBe('token');
  });

  it('bridge takes priority over gateway when both bits set', () => {
    expect(classifyCurrency({
      systemid: 'iA',
      currencyid: 'iB',
      options: 0x280, // bridge + gateway
    })).toBe('bridge');
  });
});

describe('CURRENCY_TYPE_ORDER', () => {
  it('has correct sort priorities', () => {
    expect(CURRENCY_TYPE_ORDER.native).toBe(0);
    expect(CURRENCY_TYPE_ORDER.gateway).toBe(1);
    expect(CURRENCY_TYPE_ORDER.bridge).toBe(2);
    expect(CURRENCY_TYPE_ORDER.liquidity_pool).toBe(3);
    expect(CURRENCY_TYPE_ORDER.token).toBe(4);
    expect(CURRENCY_TYPE_ORDER.nft).toBe(5);
  });

  it('allows sorting currencies by type', () => {
    const types: CurrencyType[] = ['nft', 'native', 'token', 'bridge'];
    const sorted = [...types].sort((a, b) => CURRENCY_TYPE_ORDER[a] - CURRENCY_TYPE_ORDER[b]);
    expect(sorted).toEqual(['native', 'bridge', 'token', 'nft']);
  });
});
