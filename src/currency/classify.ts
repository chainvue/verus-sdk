/**
 * Currency classification from getcurrency RPC response
 */

export type CurrencyType = 'native' | 'gateway' | 'bridge' | 'liquidity_pool' | 'token' | 'nft';

/** Sort priority: native first, then gateway, bridge, liquidity_pool, token, nft */
export const CURRENCY_TYPE_ORDER: Record<CurrencyType, number> = {
  native: 0,
  gateway: 1,
  bridge: 2,
  liquidity_pool: 3,
  token: 4,
  nft: 5,
};

/** Classify a getcurrency RPC response by its options bitmask */
export function classifyCurrency(currencyInfo: {
  systemid?: string;
  currencyid?: string;
  options?: number;
  currencies?: any;
}): CurrencyType {
  if (currencyInfo.systemid === currencyInfo.currencyid) return 'native';
  const opts = currencyInfo.options ?? 0;
  if (opts & 0x200) return 'bridge';
  if (opts & 0x80) return 'gateway';
  if ((opts & 0x01) && currencyInfo.currencies) return 'liquidity_pool';
  if (opts & 0x800) return 'nft';
  return 'token';
}
