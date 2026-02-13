import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  serializeNameReservation,
  serializeAdvancedNameReservation,
  calculateCommitmentHash,
  serializeCommitmentHash,
  buildCommitmentScript,
  buildReservationScript,
  buildP2IDScript,
  buildReferralPaymentScript,
  calculateRegistrationFees,
  createIdentityObject,
  deriveIdentityAddress,
  isVRSCParent,
  prepareNameCommitment,
} from '../src/identity/index.js';
import { NETWORK_CONFIG, DEFAULT_REGISTRATION_FEE } from '../src/constants/index.js';
import { iAddressToHash } from '../src/utils/index.js';

const SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;
const TEST_ADDR = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';

describe('identity', () => {
  describe('generateSalt', () => {
    it('should generate a 32-byte buffer', () => {
      const salt = generateSalt();
      expect(salt.length).toBe(32);
    });

    it('should generate unique salts', () => {
      const s1 = generateSalt();
      const s2 = generateSalt();
      expect(s1.equals(s2)).toBe(false);
    });
  });

  describe('serializeNameReservation', () => {
    it('should serialize correctly', () => {
      const name = 'test';
      const referralHash = Buffer.alloc(20, 0);
      const salt = Buffer.alloc(32, 0xaa);

      const buf = serializeNameReservation(name, referralHash, salt);
      // compactSize(4) = 1 byte + "test" = 4 bytes + referral 20 + salt 32 = 57
      expect(buf.length).toBe(1 + 4 + 20 + 32);
      expect(buf[0]).toBe(4); // name length
      expect(buf.slice(1, 5).toString('utf8')).toBe('test');
    });
  });

  describe('serializeAdvancedNameReservation', () => {
    it('should include version prefix', () => {
      const name = 'sub';
      const parentHash = Buffer.alloc(20, 0xbb);
      const referralHash = Buffer.alloc(20, 0);
      const salt = Buffer.alloc(32, 0xcc);

      const buf = serializeAdvancedNameReservation(1, name, parentHash, referralHash, salt);
      // version(4) + compactSize(3)=1 + "sub"=3 + parent(20) + referral(20) + salt(32) = 80
      expect(buf.length).toBe(4 + 1 + 3 + 20 + 20 + 32);
      expect(buf.readUInt32LE(0)).toBe(1); // version
    });
  });

  describe('calculateCommitmentHash', () => {
    it('should return a 32-byte hash', () => {
      const data = Buffer.from('test reservation data');
      const hash = calculateCommitmentHash(data);
      expect(hash.length).toBe(32);
    });

    it('should be deterministic', () => {
      const data = Buffer.from('test reservation data');
      const h1 = calculateCommitmentHash(data);
      const h2 = calculateCommitmentHash(data);
      expect(h1.equals(h2)).toBe(true);
    });
  });

  describe('serializeCommitmentHash', () => {
    it('should produce TokenOutput prefix + 32-byte hash', () => {
      const hash = Buffer.alloc(32, 0xdd);
      const serialized = serializeCommitmentHash(hash);
      // TokenOutput with version=0 → 0x00 + hash(32) = 33 bytes
      expect(serialized.length).toBe(33);
      expect(serialized[0]).toBe(0); // VERSION_INVALID
    });
  });

  describe('buildCommitmentScript', () => {
    it('should produce a non-empty script', () => {
      const hash = Buffer.alloc(32, 0xee);
      const script = buildCommitmentScript(hash, TEST_ADDR);
      expect(script.length).toBeGreaterThan(0);
    });
  });

  describe('buildReservationScript', () => {
    it('should produce a non-empty script for standard reservation', () => {
      const reservation = Buffer.from('test');
      const iAddr = deriveIdentityAddress('testid', SYSTEM_ID);
      const script = buildReservationScript(iAddr, reservation, false);
      expect(script.length).toBeGreaterThan(0);
    });

    it('should produce a different script for advanced reservation', () => {
      const reservation = Buffer.from('test');
      const iAddr = deriveIdentityAddress('testid', SYSTEM_ID);
      const stdScript = buildReservationScript(iAddr, reservation, false);
      const advScript = buildReservationScript(iAddr, reservation, true);
      expect(stdScript.equals(advScript)).toBe(false);
    });
  });

  describe('buildP2IDScript', () => {
    it('should build a valid P2ID script', () => {
      const iAddr = deriveIdentityAddress('testid', SYSTEM_ID);
      const script = buildP2IDScript(iAddr);
      // P2ID = OP_DUP(1) OP_HASH160(1) PUSH20(1) <hash>(20) OP_EQUALVERIFY(1) OP_CHECKSIG(1) OP_CHECKCRYPTOCONDITION(1) = 26 bytes
      expect(script.length).toBe(26);
    });
  });

  describe('buildReferralPaymentScript', () => {
    it('should produce a non-empty CC script', () => {
      const iAddr = deriveIdentityAddress('referrer', SYSTEM_ID);
      const script = buildReferralPaymentScript(iAddr);
      expect(script.length).toBeGreaterThan(0);
    });
  });

  describe('calculateRegistrationFees', () => {
    it('should return full fee when no referral', () => {
      const result = calculateRegistrationFees(false);
      expect(result.issuerFee).toBe(DEFAULT_REGISTRATION_FEE);
      expect(result.referralAmount).toBe(0);
      expect(result.totalRequired).toBe(DEFAULT_REGISTRATION_FEE);
    });

    it('should split fee with referral (default 3 levels)', () => {
      const result = calculateRegistrationFees(true);
      // issuerFee = floor(100 * 4/5) = 80 VRSC
      expect(result.issuerFee).toBe(8_000_000_000);
      // referralAmount = floor(100 / 5) = 20 VRSC
      expect(result.referralAmount).toBe(2_000_000_000);
    });
  });

  describe('deriveIdentityAddress', () => {
    it('should derive an i-address', () => {
      const addr = deriveIdentityAddress('testname', SYSTEM_ID);
      expect(addr).toMatch(/^i[A-Za-z0-9]+$/);
    });

    it('should derive different addresses for different names', () => {
      const a1 = deriveIdentityAddress('name1', SYSTEM_ID);
      const a2 = deriveIdentityAddress('name2', SYSTEM_ID);
      expect(a1).not.toBe(a2);
    });
  });

  describe('isVRSCParent', () => {
    it('should return true for undefined parent', () => {
      expect(isVRSCParent(undefined)).toBe(true);
    });

    it('should return true for system ID', () => {
      expect(isVRSCParent(SYSTEM_ID, 'testnet')).toBe(true);
    });

    it('should return false for a different parent', () => {
      expect(isVRSCParent('i96QBukWPW1LTbtftFq7TUSZAeXcwUcboX', 'testnet')).toBe(false);
    });
  });

  describe('prepareNameCommitment', () => {
    it('should produce all required commitment data', () => {
      const result = prepareNameCommitment('mytest', TEST_ADDR, undefined, undefined, 'testnet');
      expect(result.salt.length).toBe(32);
      expect(result.serializedReservation.length).toBeGreaterThan(0);
      expect(result.commitmentHash.length).toBe(32);
      expect(result.serializedCommitmentHash.length).toBe(33);
      expect(result.commitmentScript.length).toBeGreaterThan(0);
      expect(result.identityAddress).toMatch(/^i/);
    });
  });

  describe('createIdentityObject', () => {
    it('should create a valid Identity', () => {
      const identity = createIdentityObject({
        name: 'testid',
        primaryAddresses: [TEST_ADDR],
        revocationAuthority: deriveIdentityAddress('testid', SYSTEM_ID),
        recoveryAuthority: deriveIdentityAddress('testid', SYSTEM_ID),
        parentIAddress: SYSTEM_ID,
        systemId: SYSTEM_ID,
      });
      expect(identity.name).toBe('testid');
      expect(identity.getIdentityAddress()).toMatch(/^i/);
    });
  });
});
