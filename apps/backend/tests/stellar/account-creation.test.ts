/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Account,
  StrKey,
} from 'stellar-sdk';
import { HORIZON_URLS } from '../../../../packages/stellar/src/config';
import { checkHorizonEndpoint } from '../../src/lib/stellar/endpoint-connectivity';

const TIMEOUT_MS = 240_000; // High timeout for testnet interactions
const HORIZON_URL = HORIZON_URLS.testnet;

describe('Stellar Account Creation Lifecycle', () => {
  let horizonReachable = false;

  beforeAll(async () => {
    const result = await checkHorizonEndpoint(HORIZON_URL, { timeout: 15_000 });
    horizonReachable = result.reachable;
    if (!horizonReachable) {
      console.warn('Skipping: testnet Horizon unreachable');
    }
  }, 20_000);

  async function fetchAccount(publicKey: string) {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (!res.ok) throw new Error(`Account not found: ${publicKey}`);
    return await res.json();
  }

  async function fundAccount(publicKey: string) {
    const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Friendbot funding failed: ${body}`);
    }
    
    // Poll for account existence
    let retry = 0;
    while (retry < 20) {
      try {
        await fetchAccount(publicKey);
        return true;
      } catch (e) {
        retry++;
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    throw new Error(`Account ${publicKey} still not found after funding`);
  }

  // 1. Account Creation Flow
  describe('Account Creation Flow', () => {
    it('generates a valid keypair', () => {
      const kp = Keypair.random();
      expect(kp.publicKey()).toBeDefined();
      expect(kp.secret()).toBeDefined();
      expect(StrKey.isValidEd25519PublicKey(kp.publicKey())).toBe(true);
      expect(StrKey.isValidEd25519SecretSeed(kp.secret())).toBe(true);
    });

    it('creates a new account on testnet via funding', async () => {
      if (!horizonReachable) return;
      
      const kp = Keypair.random();
      const publicKey = kp.publicKey();
      
      await fundAccount(publicKey);
      
      const accountData = await fetchAccount(publicKey);
      expect(accountData.account_id).toBe(publicKey);
    }, TIMEOUT_MS);
  });

  // 2. Funding Verification
  describe('Funding Verification', () => {
    it('receives expected funding amount from Friendbot', async () => {
      if (!horizonReachable) return;

      const kp = Keypair.random();
      const publicKey = kp.publicKey();
      
      await fundAccount(publicKey);
      
      const accountData = await fetchAccount(publicKey);
      const nativeBalance = accountData.balances.find((b: any) => b.asset_type === 'native');
      
      expect(nativeBalance).toBeDefined();
      // Friendbot usually funds with 10,000 XLM
      expect(parseFloat(nativeBalance.balance)).toBeGreaterThanOrEqual(10000);
    }, TIMEOUT_MS);
  });

  // 3. Account Activation
  describe('Account Activation', () => {
    it('initializes sequence number and can perform transactions', async () => {
      if (!horizonReachable) return;

      const kp = Keypair.random();
      const publicKey = kp.publicKey();
      
      await fundAccount(publicKey);
      
      const accountData = await fetchAccount(publicKey);
      expect(accountData.sequence).toBeDefined();
      expect(BigInt(accountData.sequence)).toBeGreaterThan(0n);

      // Verify it can perform a transaction (Manage Data)
      const account = new Account(accountData.account_id, accountData.sequence);
      const tx = new TransactionBuilder(account, {
        fee: '1000',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.manageData({ name: 'Activated', value: 'true' }))
        .setTimeout(30)
        .build();

      tx.sign(kp);
      
      const xdr = tx.toXDR();
      const res = await fetch(`${HORIZON_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tx: xdr })
      });
      
      expect(res.ok).toBe(true);
    }, TIMEOUT_MS);
  });

  // 4. Minimum Balance Requirements
  describe('Minimum Balance Requirements', () => {
    it('respects base reserve requirements', async () => {
      if (!horizonReachable) return;

      const kp = Keypair.random();
      await fundAccount(kp.publicKey());
      
      const accountData = await fetchAccount(kp.publicKey());
      // Minimum balance = (2 + # entries) * 0.5 XLM
      // For a new account with 0 entries, it's 2 * 0.5 = 1 XLM
      expect(parseFloat(accountData.balances.find((b: any) => b.asset_type === 'native').balance)).toBeGreaterThan(1);
    }, TIMEOUT_MS);

    it('fails to create account with zero balance if not sponsored', async () => {
      if (!horizonReachable) return;

      const creator = Keypair.random();
      await fundAccount(creator.publicKey());
      
      const destination = Keypair.random();
      const creatorData = await fetchAccount(creator.publicKey());
      const creatorAcc = new Account(creatorData.account_id, creatorData.sequence);
      
      const tx = new TransactionBuilder(creatorAcc, {
        fee: '1000',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.createAccount({
          destination: destination.publicKey(),
          startingBalance: '0', // Invalid, must be >= 1 XLM unless sponsored
        }))
        .setTimeout(30)
        .build();

      tx.sign(creator);
      
      const xdr = tx.toXDR();
      const res = await fetch(`${HORIZON_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tx: xdr })
      });
      
      expect(res.ok).toBe(false);
      const errorData = await res.json();
      expect(errorData.extras.result_codes.operations).toContain('op_low_reserve');
    }, TIMEOUT_MS);
  });

  // 5. Account Metadata Verification
  describe('Account Metadata Verification', () => {
    it('retrieves correct account metadata', async () => {
      if (!horizonReachable) return;

      const kp = Keypair.random();
      await fundAccount(kp.publicKey());
      
      const accountData = await fetchAccount(kp.publicKey());
      
      expect(accountData).toHaveProperty('id');
      expect(accountData).toHaveProperty('account_id', kp.publicKey());
      expect(accountData).toHaveProperty('sequence');
      expect(accountData).toHaveProperty('balances');
      expect(Array.isArray(accountData.balances)).toBe(true);
    }, TIMEOUT_MS);
  });

  // 6. Error Handling Scenarios
  describe('Error Handling', () => {
    it('handles invalid keypair validation', () => {
      const invalidAddress = 'GINVALID';
      expect(StrKey.isValidEd25519PublicKey(invalidAddress)).toBe(false);
    });

    it('handles failed funding request (invalid address)', async () => {
      const invalidAddress = 'GINVALID';
      await expect(fundAccount(invalidAddress)).rejects.toThrow();
    });

    it('handles duplicate account creation attempts (idempotent friendbot)', async () => {
      if (!horizonReachable) return;

      const kp = Keypair.random();
      await fundAccount(kp.publicKey());
      
      // Second funding attempt should work (friendbot is idempotent)
      await expect(fundAccount(kp.publicKey())).resolves.toBe(true);
    }, TIMEOUT_MS);

    it('fails to load non-existent account', async () => {
      if (!horizonReachable) return;

      const kp = Keypair.random();
      await expect(fetchAccount(kp.publicKey())).rejects.toThrow();
    });
  });
});
