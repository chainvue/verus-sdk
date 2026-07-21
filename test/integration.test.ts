import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { VerusSDK, NETWORK_CONFIG } from '../src/index.js';
import { addressToScriptPubKey } from '../src/utils/index.js';

const TEST_WIF_A = 'UusoQWsobQKUkezgBJa22D9G4t9Avo6k8wD5UUxmmfAEoTN8bawc';
const TEST_ADDR_A = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';
const TEST_ADDR_B = 'RPsQDnaxXgrLjcVBh3SpvCpTabWxAdMdzu';
const SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;

function makeP2PKHScript(address: string): string {
  return addressToScriptPubKey(address).toString('hex');
}

function makeFundingUtxo(address: string, satoshis: bigint): {
  txid: string; outputIndex: number; satoshis: bigint; script: string;
} {
  return {
    // A real random 32-byte txid. The previous Buffer.alloc(32, rand)
    // filled ALL bytes with the same value, so ~1/255 runs produced an
    // all-zeros txid — the coinbase marker utxo-lib refuses to sign
    // ("coinbase inputs not supported"). It flaked the release gate in CI.
    txid: randomBytes(32).toString('hex'),
    outputIndex: 0,
    satoshis,
    script: makeP2PKHScript(address),
  };
}

describe('VerusSDK integration', () => {
  const sdk = new VerusSDK({ network: 'testnet' });

  describe('static utilities', () => {
    it('should derive address from WIF', async () => {
      const addr = await VerusSDK.deriveAddress(TEST_WIF_A);
      expect(addr).toBe(TEST_ADDR_A);
    });

    it('should derive identity address', () => {
      const iAddr = VerusSDK.deriveIdentityAddress('myid', SYSTEM_ID);
      expect(iAddr).toMatch(/^i[A-Za-z0-9]+$/);
    });

    it('should generate a valid WIF', () => {
      const wif = VerusSDK.generateWif();
      const validation = VerusSDK.validateWif(wif);
      expect(validation.valid).toBe(true);
    });

    it('should validate addresses', () => {
      expect(VerusSDK.validateAddress(TEST_ADDR_A).valid).toBe(true);
      expect(VerusSDK.validateAddress('invalid').valid).toBe(false);
    });
  });

  describe('buildAndSign', () => {
    it('should build and sign a P2PKH transaction', () => {
      const result = sdk.buildAndSign({
        wif: TEST_WIF_A,
        expiryHeight: 0,
        inputs: [{
          txid: 'a'.repeat(64),
          vout: 0,
          scriptPubKey: makeP2PKHScript(TEST_ADDR_A),
          amount: 50_000_000n,
        }],
        outputs: [{
          address: TEST_ADDR_B,
          amount: 49_990_000n, // Leave 10000 sat fee
        }],
      });

      expect(result.signedTx).toBeTruthy();
      expect(result.txid).toHaveLength(64);
      expect(result.fee).toBe(10_000n);
    });
  });

  describe('transfer', () => {
    it('should build and sign a native VRSC transfer', () => {
      const utxo = makeFundingUtxo(TEST_ADDR_A, 500_000_000n);
      const result = sdk.transfer({
        wif: TEST_WIF_A,
        to: TEST_ADDR_B,
        amount: 100_000_000n,
        utxos: [utxo],
        changeAddress: TEST_ADDR_A,
        expiryHeight: 0,
      });

      expect(result.signedTx).toBeTruthy();
      expect(result.txid).toHaveLength(64);
      expect(result.fee).toBeGreaterThan(0n);
      expect(result.inputsUsed).toBe(1);
    });
  });

  describe('signMessage + verifyMessage', () => {
    it('should round-trip sign and verify', async () => {
      const identityAddress = VerusSDK.deriveIdentityAddress('testid', SYSTEM_ID);
      const signingAddress = await VerusSDK.deriveAddress(TEST_WIF_A);

      const sig = sdk.signMessage({
        wif: TEST_WIF_A,
        message: 'SDK integration test',
        identityAddress,
        blockHeight: 42,
      });

      expect(sig.signature).toBeTruthy();
      expect(sig.signingAddress).toBe(signingAddress);

      const verify = sdk.verifyMessage({
        message: 'SDK integration test',
        signature: sig.signature,
        signingAddress: sig.signingAddress,
        identityAddress,
        blockHeight: 42,
      });

      expect(verify.valid).toBe(true);
    });
  });

  describe('createCommitment', () => {
    it('should build and sign a name commitment', () => {
      const utxo = makeFundingUtxo(TEST_ADDR_A, 100_000_000n);

      const result = sdk.createCommitment({
        wif: TEST_WIF_A,
        name: 'sdktest',
        utxos: [utxo],
        changeAddress: TEST_ADDR_A,
        expiryHeight: 0,
      });

      expect(result.signedTx).toBeTruthy();
      expect(result.txid).toHaveLength(64);
      expect(result.identityAddress).toMatch(/^i/);
      expect(result.commitmentData.name).toBe('sdktest');
      expect(result.commitmentData.salt).toHaveLength(64);
      expect(result.commitmentData.namereservationHex).toBeTruthy();
      expect(result.commitmentData.commitmentHash).toHaveLength(64);
    });

    it('should generate different commitments for different names', () => {
      const utxo1 = makeFundingUtxo(TEST_ADDR_A, 100_000_000n);
      const utxo2 = makeFundingUtxo(TEST_ADDR_A, 100_000_000n);

      const r1 = sdk.createCommitment({
        wif: TEST_WIF_A,
        name: 'name1',
        utxos: [utxo1],
        changeAddress: TEST_ADDR_A,
        expiryHeight: 0,
      });

      const r2 = sdk.createCommitment({
        wif: TEST_WIF_A,
        name: 'name2',
        utxos: [utxo2],
        changeAddress: TEST_ADDR_A,
        expiryHeight: 0,
      });

      expect(r1.identityAddress).not.toBe(r2.identityAddress);
      expect(r1.commitmentData.commitmentHash).not.toBe(r2.commitmentData.commitmentHash);
    });
  });

  describe('exports', () => {
    it('should export all expected types and modules', async () => {
      const mod = await import('../src/index.js');

      // Facade
      expect(mod.VerusSDK).toBeDefined();

      // Constants
      expect(mod.NETWORK_CONFIG).toBeDefined();
      expect(mod.VERSION_GROUP_ID).toBe(0x892f2085);
      expect(mod.DEFAULT_REGISTRATION_FEE).toBe(10_000_000_000n);

      // Submodules
      expect(mod.keys).toBeDefined();
      expect(mod.signing).toBeDefined();
      expect(mod.utxo).toBeDefined();
      expect(mod.identity).toBeDefined();
      expect(mod.transfer).toBeDefined();
      expect(mod.message).toBeDefined();
      expect(mod.currency).toBeDefined();
      expect(mod.utils).toBeDefined();
      expect(mod.offers).toBeDefined();
    });

    it('should expose the offers suite via the namespace and the facade', async () => {
      const mod = await import('../src/index.js');
      const sdk = new mod.VerusSDK({ network: 'testnet' });
      const flows = [
        'buildOfferFunding',
        'buildOffer',
        'completeOffer',
        'buildReclaimOffer',
        'buildSellIdentityOffer',
        'completeSellIdentityOffer',
        'buildBuyIdentityOffer',
        'completeBuyIdentityOffer',
        'buildSwapIdentityOffer',
        'completeSwapIdentityOffer',
      ] as const;
      for (const fn of flows) {
        expect(typeof mod.offers[fn]).toBe('function');
        expect(typeof (sdk as unknown as Record<string, unknown>)[fn]).toBe('function');
      }
      // The lower-level fulfillment signers stay internal (not on the public namespace).
      expect((mod.offers as Record<string, unknown>)['signOfferInput']).toBeUndefined();
      expect((mod.offers as Record<string, unknown>)['signTakerInputs']).toBeUndefined();
    });

    it('should expose the currency-definition serializer via namespace, facade, and top level', async () => {
      const mod = await import('../src/index.js');
      const sdk = new mod.VerusSDK({ network: 'testnet' });
      expect(typeof mod.buildCurrencyDefinitionScript).toBe('function');
      expect(typeof mod.serializeCurrencyDefinition).toBe('function');
      expect(typeof mod.currency.buildCurrencyDefinitionScript).toBe('function');
      expect(typeof sdk.buildCurrencyDefinitionScript).toBe('function');
      expect(mod.CURRENCY_OPTION.TOKEN).toBe(0x20);
      expect(mod.CURRENCY_OPTION.FRACTIONAL).toBe(0x1);
      // Full offline launch-output builder, exposed at top level, namespace, and facade.
      expect(typeof mod.buildCurrencyLaunchOutputs).toBe('function');
      expect(typeof mod.currency.buildCurrencyLaunchOutputs).toBe('function');
      expect(typeof sdk.buildCurrencyLaunchOutputs).toBe('function');
    });
  });
});
