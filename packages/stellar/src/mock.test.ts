/**
 * Unit Tests for Stellar Horizon Mock Utilities
 *
 * Tests the mock factory functions to ensure they generate objects
 * with the correct structure and properties expected by downstream tests.
 */

import { describe, it, expect } from 'vitest';
import {
  makeAccountResponse,
  makeTxResponse,
  makeLedgerResponse,
  makeAssetResponse,
  makeOrderBookResponse,
} from './mock';

describe('Stellar Mock Factories', () => {
  describe('makeAccountResponse', () => {
    it('should generate a valid account response with minimum required fields', () => {
      const accountId = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
      const account = makeAccountResponse(accountId);

      expect(account).toBeDefined();
      expect(account.id).toBe(accountId);
      expect(account.account_id).toBe(accountId);
      expect(account.balances).toBeDefined();
      expect(Array.isArray(account.balances)).toBe(true);
    });

    it('should include native XLM balance by default', () => {
      const accountId = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
      const account = makeAccountResponse(accountId);

      const nativeBalance = account.balances.find((b) => b.asset_type === 'native');
      expect(nativeBalance).toBeDefined();
      expect(nativeBalance?.balance).toBeDefined();
    });

    it('should have required threshold fields', () => {
      const accountId = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
      const account = makeAccountResponse(accountId);

      expect(account.thresholds).toBeDefined();
      expect(account.thresholds.low_threshold).toBeDefined();
      expect(account.thresholds.med_threshold).toBeDefined();
      expect(account.thresholds.high_threshold).toBeDefined();
    });

    it('should have required flags fields', () => {
      const accountId = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
      const account = makeAccountResponse(accountId);

      expect(account.flags).toBeDefined();
      expect(account.flags.auth_required).toBeDefined();
      expect(account.flags.auth_revocable).toBeDefined();
      expect(account.flags.auth_immutable).toBeDefined();
    });

    it('should have sequence number', () => {
      const accountId = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
      const account = makeAccountResponse(accountId);

      expect(account.sequence).toBeDefined();
      expect(typeof account.sequence).toBe('string');
    });

    it('should include signers with account owner', () => {
      const accountId = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
      const account = makeAccountResponse(accountId);

      expect(account.signers).toBeDefined();
      expect(Array.isArray(account.signers)).toBe(true);
      expect(account.signers.length).toBeGreaterThan(0);
      const ownerSigner = account.signers.find((s) => s.key === accountId);
      expect(ownerSigner).toBeDefined();
    });

    it('should have _links object with relevant URLs', () => {
      const accountId = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
      const account = makeAccountResponse(accountId);

      expect(account._links).toBeDefined();
      expect(account._links.self).toBeDefined();
      expect(account._links.self.href).toContain(accountId);
      expect(account._links.transactions).toBeDefined();
      expect(account._links.operations).toBeDefined();
    });

    it('should allow overrides to be applied', () => {
      const accountId = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
      const customSequence = '999';
      const account = makeAccountResponse(accountId, { sequence: customSequence });

      expect(account.sequence).toBe(customSequence);
      expect(account.id).toBe(accountId);
    });

    it('should allow partial overrides without losing defaults', () => {
      const accountId = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
      const account = makeAccountResponse(accountId, {
        flags: { auth_required: true, auth_revocable: false, auth_immutable: false },
      });

      expect(account.flags.auth_required).toBe(true);
      expect(account.id).toBe(accountId);
      expect(account.thresholds).toBeDefined();
    });
  });

  describe('makeTxResponse', () => {
    it('should generate a valid transaction response', () => {
      const hash = 'abc123def456';
      const tx = makeTxResponse(hash);

      expect(tx).toBeDefined();
      expect(tx.id).toBe(hash);
      expect(tx.hash).toBe(hash);
    });

    it('should have required transaction fields', () => {
      const hash = 'abc123def456';
      const tx = makeTxResponse(hash);

      expect(tx.ledger).toBeDefined();
      expect(tx.created_at).toBeDefined();
      expect(tx.source_account).toBeDefined();
      expect(tx.fee_charged).toBeDefined();
      expect(tx.operation_count).toBeDefined();
    });

    it('should have XDR representation fields', () => {
      const hash = 'abc123def456';
      const tx = makeTxResponse(hash);

      expect(tx.envelope_xdr).toBeDefined();
      expect(tx.result_xdr).toBeDefined();
      expect(tx.result_meta_xdr).toBeDefined();
    });

    it('should be marked successful by default', () => {
      const hash = 'abc123def456';
      const tx = makeTxResponse(hash);

      expect(tx.successful).toBe(true);
    });

    it('should have paging token', () => {
      const hash = 'abc123def456';
      const tx = makeTxResponse(hash);

      expect(tx.paging_token).toBeDefined();
      expect(typeof tx.paging_token).toBe('string');
    });

    it('should have _links with transaction URLs', () => {
      const hash = 'abc123def456';
      const tx = makeTxResponse(hash);

      expect(tx._links).toBeDefined();
      expect(tx._links.self).toBeDefined();
      expect(tx._links.self.href).toContain(hash);
      expect(tx._links.account).toBeDefined();
    });

    it('should allow marking transaction as failed', () => {
      const hash = 'abc123def456';
      const tx = makeTxResponse(hash, { successful: false });

      expect(tx.successful).toBe(false);
      expect(tx.hash).toBe(hash);
    });

    it('should allow custom fee and operation count', () => {
      const hash = 'abc123def456';
      const tx = makeTxResponse(hash, { fee_charged: '500', operation_count: 5 });

      expect(tx.fee_charged).toBe('500');
      expect(tx.operation_count).toBe(5);
    });
  });

  describe('makeLedgerResponse', () => {
    it('should generate a valid ledger response', () => {
      const sequence = 1000;
      const ledger = makeLedgerResponse(sequence);

      expect(ledger).toBeDefined();
      expect(ledger.sequence).toBe(sequence);
    });

    it('should have required ledger fields', () => {
      const sequence = 1000;
      const ledger = makeLedgerResponse(sequence);

      expect(ledger.id).toBeDefined();
      expect(ledger.paging_token).toBeDefined();
      expect(ledger.hash).toBeDefined();
      expect(ledger.prev_hash).toBeDefined();
      expect(ledger.timestamp).toBeDefined();
      expect(ledger.transaction_count).toBeDefined();
      expect(ledger.operation_count).toBeDefined();
      expect(ledger.closed_at).toBeDefined();
    });

    it('should have protocol information', () => {
      const sequence = 1000;
      const ledger = makeLedgerResponse(sequence);

      expect(ledger.base_fee_in_stroops).toBeDefined();
      expect(ledger.base_reserve_in_stroops).toBeDefined();
      expect(ledger.max_tx_set_size).toBeDefined();
      expect(ledger.protocol_version).toBeDefined();
    });

    it('should have coin supply information', () => {
      const sequence = 1000;
      const ledger = makeLedgerResponse(sequence);

      expect(ledger.total_coins).toBeDefined();
      expect(ledger.fee_pool).toBeDefined();
    });

    it('should have _links to ledger resources', () => {
      const sequence = 1000;
      const ledger = makeLedgerResponse(sequence);

      expect(ledger._links).toBeDefined();
      expect(ledger._links.self).toBeDefined();
      expect(ledger._links.self.href).toContain(String(sequence));
      expect(ledger._links.transactions).toBeDefined();
    });

    it('should allow overrides for transaction counts', () => {
      const sequence = 1000;
      const ledger = makeLedgerResponse(sequence, { transaction_count: 42 });

      expect(ledger.transaction_count).toBe(42);
      expect(ledger.sequence).toBe(sequence);
    });
  });

  describe('makeAssetResponse', () => {
    it('should generate a valid asset response', () => {
      const asset = { code: 'USDC', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const response = makeAssetResponse(asset);

      expect(response).toBeDefined();
      expect(response.asset_code).toBe(asset.code);
      expect(response.asset_issuer).toBe(asset.issuer);
    });

    it('should determine asset_type from code length', () => {
      const asset4 = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const response4 = makeAssetResponse(asset4);
      expect(response4.asset_type).toBe('credit_alphanum4');

      const asset12 = { code: 'LONGASSETCDE', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const response12 = makeAssetResponse(asset12);
      expect(response12.asset_type).toBe('credit_alphanum12');
    });

    it('should have account statistics', () => {
      const asset = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const response = makeAssetResponse(asset);

      expect(response.accounts).toBeDefined();
      expect(response.accounts.authorized).toBeDefined();
      expect(response.accounts.authorized_to_maintain_liabilities).toBeDefined();
      expect(response.accounts.unauthorized).toBeDefined();
    });

    it('should have balance statistics', () => {
      const asset = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const response = makeAssetResponse(asset);

      expect(response.balances).toBeDefined();
      expect(response.balances.authorized).toBeDefined();
      expect(response.balances.authorized_to_maintain_liabilities).toBeDefined();
      expect(response.balances.unauthorized).toBeDefined();
    });

    it('should have flags', () => {
      const asset = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const response = makeAssetResponse(asset);

      expect(response.flags).toBeDefined();
      expect(response.flags.auth_required).toBeDefined();
      expect(response.flags.auth_revocable).toBeDefined();
      expect(response.flags.auth_immutable).toBeDefined();
    });

    it('should have paging token based on asset', () => {
      const asset = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const response = makeAssetResponse(asset);

      expect(response.paging_token).toContain(asset.code);
      expect(response.paging_token).toContain(asset.issuer);
    });

    it('should allow overrides', () => {
      const asset = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const response = makeAssetResponse(asset, { clawback_enabled: true });

      expect(response.clawback_enabled).toBe(true);
      expect(response.asset_code).toBe(asset.code);
    });
  });

  describe('makeOrderBookResponse', () => {
    it('should generate a valid order book response', () => {
      const base = { code: 'USDC', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const counter = { code: 'XLM', issuer: '' };
      const orderBook = makeOrderBookResponse(base, counter);

      expect(orderBook).toBeDefined();
      expect(orderBook.base).toBeDefined();
      expect(orderBook.counter).toBeDefined();
    });

    it('should include base asset details', () => {
      const base = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const counter = { code: 'XLM', issuer: '' };
      const orderBook = makeOrderBookResponse(base, counter);

      expect(orderBook.base.asset_code).toBe(base.code);
      expect(orderBook.base.asset_issuer).toBe(base.issuer);
    });

    it('should include counter asset details', () => {
      const base = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const counter = { code: 'EUR', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const orderBook = makeOrderBookResponse(base, counter);

      expect(orderBook.counter.asset_code).toBe(counter.code);
      expect(orderBook.counter.asset_issuer).toBe(counter.issuer);
    });

    it('should include bids array with price and amount', () => {
      const base = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const counter = { code: 'XLM', issuer: '' };
      const orderBook = makeOrderBookResponse(base, counter);

      expect(Array.isArray(orderBook.bids)).toBe(true);
      expect(orderBook.bids.length).toBeGreaterThan(0);
      orderBook.bids.forEach((bid) => {
        expect(bid.price).toBeDefined();
        expect(bid.amount).toBeDefined();
        expect(bid.price_r).toBeDefined();
      });
    });

    it('should include asks array with price and amount', () => {
      const base = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const counter = { code: 'XLM', issuer: '' };
      const orderBook = makeOrderBookResponse(base, counter);

      expect(Array.isArray(orderBook.asks)).toBe(true);
      expect(orderBook.asks.length).toBeGreaterThan(0);
      orderBook.asks.forEach((ask) => {
        expect(ask.price).toBeDefined();
        expect(ask.amount).toBeDefined();
        expect(ask.price_r).toBeDefined();
      });
    });

    it('should allow overrides', () => {
      const base = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const counter = { code: 'XLM', issuer: '' };
      const customBids = [{ price: '0.1', amount: '100.0', price_r: { n: 1, d: 10 } }];
      const orderBook = makeOrderBookResponse(base, counter, { bids: customBids });

      expect(orderBook.bids).toEqual(customBids);
      expect(orderBook.base.asset_code).toBe(base.code);
    });

    it('should handle native asset (empty issuer) for counter', () => {
      const base = { code: 'USD', issuer: 'GBBD47HS4NKJ5I25FH7KSQRARX6FQWHJ3AHHUCBYYUGWZ4RUXDDNF7K7' };
      const counter = { code: 'XLM', issuer: '' };
      const orderBook = makeOrderBookResponse(base, counter);

      expect(orderBook.counter.asset_issuer).toBe('');
    });
  });

  describe('Cross-factory consistency', () => {
    it('should have consistent date/timestamp formats', () => {
      const account = makeAccountResponse('GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ');
      const tx = makeTxResponse('abc123');
      const ledger = makeLedgerResponse(1000);

      const accountDate = new Date(account.last_modified_time);
      const txDate = new Date(tx.created_at);
      const ledgerDate = new Date(ledger.closed_at);

      expect(accountDate.getTime()).toBeGreaterThan(0);
      expect(txDate.getTime()).toBeGreaterThan(0);
      expect(ledgerDate.getTime()).toBeGreaterThan(0);
    });

    it('should generate different objects on each call (not cached)', () => {
      const account1 = makeAccountResponse('GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ');
      const account2 = makeAccountResponse('GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ');

      expect(account1).not.toBe(account2);
      expect(account1.id).toBe(account2.id);
    });
  });
});
