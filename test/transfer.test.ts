import { describe, it, expect } from 'vitest';
import { buildAndSign, transfer, transferToken, sendCurrency } from '../src/transfer/index.js';
import { addressToScriptPubKey } from '../src/utils/index.js';
import { InsufficientFundsError, InvalidAddressError, TransactionBuildError } from '../src/errors.js';
import { NETWORK_CONFIG } from '../src/constants/index.js';

const TEST_WIF = 'UusoQWsobQKUkezgBJa22D9G4t9Avo6k8wD5UUxmmfAEoTN8bawc';
const TEST_ADDR = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';
const TEST_ADDR_B = 'RPsQDnaxXgrLjcVBh3SpvCpTabWxAdMdzu';
// A real VRSCTEST identity i-address (version byte 0x66).
const TEST_IADDR = 'i4At2tf5ChLPV9pQgt7RiRQSSEdiRouRva';
const TESTNET_SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;

function makeP2PKHScript(address: string): string {
  return addressToScriptPubKey(address).toString('hex');
}

describe('transfer', () => {
  describe('buildAndSign', () => {
    it('should build and sign a simple P2PKH transaction', () => {
      const script = makeP2PKHScript(TEST_ADDR);
      const result = buildAndSign({
        wif: TEST_WIF,
        expiryHeight: 0,
        inputs: [{
          txid: 'a'.repeat(64),
          vout: 0,
          scriptPubKey: script,
          amount: 100_000_000n, // 1 VRSC
        }],
        outputs: [{
          address: TEST_ADDR_B,
          amount: 99_990_000n, // Leave 10000 sat fee (0.0001 VRSC)
        }],
      }, 'testnet');

      expect(result.signedTx).toBeTruthy();
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
      expect(result.fee).toBe(10_000n); // 0.0001 VRSC
    });

    it('should use explicit fee if provided', () => {
      const script = makeP2PKHScript(TEST_ADDR);
      const result = buildAndSign({
        wif: TEST_WIF,
        expiryHeight: 0,
        inputs: [{
          txid: 'b'.repeat(64),
          vout: 0,
          scriptPubKey: script,
          amount: 200_000_000n,
        }],
        outputs: [{
          address: TEST_ADDR_B,
          amount: 199_950_000n,
        }],
        fee: 50_000n,
      }, 'testnet');

      expect(result.fee).toBe(50_000n);
    });

    it('should throw on insufficient funds', () => {
      const script = makeP2PKHScript(TEST_ADDR);
      expect(() =>
        buildAndSign({
          wif: TEST_WIF,
          expiryHeight: 0,
          inputs: [{
            txid: 'c'.repeat(64),
            vout: 0,
            scriptPubKey: script,
            amount: 1_000n,
          }],
          outputs: [{
            address: TEST_ADDR_B,
            amount: 100_000_000n,
          }],
          fee: 10_000n,
        }, 'testnet')
      ).toThrow(InsufficientFundsError);
    });
  });

  // Regression: an i-address passed on the PKH path was silently stripped to
  // its hash and paid to an uncontrollable R-address (verified live on VRSCTEST
  // — the daemon accepted the tx, funds lost). parseAddress must fail closed.
  describe('address-type validation (i-address burn regression)', () => {
    const nativeUtxo = {
      txid: 'a'.repeat(64),
      outputIndex: 0,
      satoshis: 100_000_000n,
      script: makeP2PKHScript(TEST_ADDR),
    };

    it('transfer() to an i-address throws instead of burning to a P2PKH output', () => {
      expect(() =>
        transfer(
          { wif: TEST_WIF, to: TEST_IADDR, amount: 90_000n, utxos: [nativeUtxo], changeAddress: TEST_ADDR, expiryHeight: 0 },
          'testnet',
        ),
      ).toThrow(InvalidAddressError);
    });

    it('transferToken() (default PKH) to an i-address throws', () => {
      expect(() =>
        transferToken(
          { wif: TEST_WIF, to: TEST_IADDR, amount: 90_000n, currency: TESTNET_SYSTEM_ID, utxos: [nativeUtxo], changeAddress: TEST_ADDR, expiryHeight: 0 },
          'testnet',
        ),
      ).toThrow(InvalidAddressError);
    });

    it("sendCurrency addressType 'ID' with an R-address throws (reverse mismatch)", () => {
      expect(() =>
        sendCurrency(
          {
            wif: TEST_WIF,
            outputs: [{ currency: TESTNET_SYSTEM_ID, satoshis: 90_000n, address: TEST_ADDR, addressType: 'ID' }],
            utxos: [nativeUtxo],
            changeAddress: TEST_ADDR,
            expiryHeight: 0,
          },
          'testnet',
        ),
      ).toThrow(InvalidAddressError);
    });

    it('the happy path still builds: native PKH send to an R-address', () => {
      const result = sendCurrency(
        {
          wif: TEST_WIF,
          outputs: [{ currency: TESTNET_SYSTEM_ID, satoshis: 90_000n, address: TEST_ADDR_B, addressType: 'PKH' }],
          utxos: [nativeUtxo],
          changeAddress: TEST_ADDR,
          expiryHeight: 0,
        },
        'testnet',
      );
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    });

    it("addressType 'ID' accepts a valid i-address (parse succeeds past validation)", () => {
      // Native to an identity is a legitimate DEST_ID output; the address check
      // must not reject a correct i-address. It builds a signed tx.
      const result = sendCurrency(
        {
          wif: TEST_WIF,
          outputs: [{ currency: TESTNET_SYSTEM_ID, satoshis: 90_000n, address: TEST_IADDR, addressType: 'ID' }],
          utxos: [nativeUtxo],
          changeAddress: TEST_ADDR,
          expiryHeight: 0,
        },
        'testnet',
      );
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // expiryHeight must be an explicit choice: omitting it previously produced a
  // never-expiring transaction (nExpiryHeight 0) silently. It is now required;
  // an explicit 0 opts into never-expiring.
  describe('expiryHeight is required', () => {
    const nativeUtxo = {
      txid: 'a'.repeat(64),
      outputIndex: 0,
      satoshis: 100_000_000n,
      script: makeP2PKHScript(TEST_ADDR),
    };

    it('throws when expiryHeight is omitted', () => {
      expect(() =>
        // @ts-expect-error deliberately omitting the now-required field
        transfer({ wif: TEST_WIF, to: TEST_ADDR_B, amount: 90_000n, utxos: [nativeUtxo], changeAddress: TEST_ADDR }, 'testnet'),
      ).toThrow(TransactionBuildError);
    });

    it('throws on a negative or non-integer expiryHeight', () => {
      expect(() =>
        transfer({ wif: TEST_WIF, to: TEST_ADDR_B, amount: 90_000n, utxos: [nativeUtxo], changeAddress: TEST_ADDR, expiryHeight: -1 }, 'testnet'),
      ).toThrow(TransactionBuildError);
    });

    it('throws on an expiryHeight at/above the Sapling cap (e.g. a timestamp)', () => {
      expect(() =>
        transfer({ wif: TEST_WIF, to: TEST_ADDR_B, amount: 90_000n, utxos: [nativeUtxo], changeAddress: TEST_ADDR, expiryHeight: 1_700_000_000 }, 'testnet'),
      ).toThrow(TransactionBuildError);
    });

    it('accepts an explicit expiryHeight (including 0 = never expires)', () => {
      const bounded = transfer({ wif: TEST_WIF, to: TEST_ADDR_B, amount: 90_000n, utxos: [nativeUtxo], changeAddress: TEST_ADDR, expiryHeight: 1_500_020 }, 'testnet');
      expect(bounded.txid).toMatch(/^[0-9a-f]{64}$/);
      const never = transfer({ wif: TEST_WIF, to: TEST_ADDR_B, amount: 90_000n, utxos: [nativeUtxo], changeAddress: TEST_ADDR, expiryHeight: 0 }, 'testnet');
      expect(never.txid).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // A non-native fee currency must be funded from its own inputs; it was omitted
  // from selection, under-funding a reserve transfer that pays its fee in a token.
  describe('non-native feeCurrency funding', () => {
    // Real VRSCTEST reserve-output script carrying token i4At2tf5… (5.0).
    const TOKEN_A = 'i4At2tf5ChLPV9pQgt7RiRQSSEdiRouRva';
    const TOKEN_B = 'i5mPWvir9xnkwd1UVHuWdEViQzTmj8gfzG';
    const TOKEN_A_SCRIPT =
      '1b0403000101150407a1d5aeb8f5202aba353a0c24a1aac2b04c3146cc360403090101150407a1d5aeb8f5202aba353a0c24a1aac2b04c31461a0107a1d5aeb8f5202aba353a0c24a1aac2b04c314680edb4c90075';

    it('requires the fee currency, so a token-denominated fee with no such inputs fails', () => {
      const tokenAUtxo = {
        txid: 'bd0cfac4603ca7e9f0a317de8046fedff419a5cf4e6e635e9e466a611d1fb401',
        outputIndex: 2,
        satoshis: 100_000_000n, // covers native + the TOKEN_A send
        script: TOKEN_A_SCRIPT,
      };
      // Sends TOKEN_A (funded) but pays the fee in TOKEN_B (not in the utxo set).
      // Before the fix the fee currency was ignored → under-funded tx; now the
      // selection demands it and fails closed on TOKEN_B.
      expect(() =>
        sendCurrency(
          {
            wif: TEST_WIF,
            outputs: [{ currency: TOKEN_A, satoshis: 100_000_000n, address: TEST_ADDR, addressType: 'PKH', feeCurrency: TOKEN_B, feeSatoshis: 5_000n }],
            utxos: [tokenAUtxo],
            changeAddress: TEST_ADDR,
            expiryHeight: 0,
          },
          'testnet',
        ),
      ).toThrow(new RegExp(TOKEN_B));
    });
  });
});
