/**
 * Stellar Horizon API Mocking Framework
 *
 * Provides comprehensive mocking for Stellar Horizon API endpoints
 * to enable offline testing and development without network dependencies.
 *
 * Usage:
 *   import { mockHorizon } from './stellar-horizon.mock';
 *   const mock = mockHorizon();
 *   mock.mockAccount('GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7UYXNMWX5XNXNXNXNXN');
 */

export interface HorizonAccount {
  id: string;
  account_id: string;
  balances: Array<{
    balance: string;
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }>;
  sequence: string;
  subentry_count: number;
  home_domain?: string;
  last_modified_ledger: number;
  last_modified_time: string;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  flags: {
    auth_required: boolean;
    auth_revocable: boolean;
    auth_immutable: boolean;
  };
  signers: Array<{
    weight: number;
    key: string;
    type: string;
  }>;
  data: Record<string, string>;
  _links: Record<string, any>;
}

export interface HorizonTransaction {
  id: string;
  paging_token: string;
  hash: string;
  ledger: number;
  created_at: string;
  source_account: string;
  source_account_sequence: string;
  fee_charged: string;
  max_fee: string;
  operation_count: number;
  envelope_xdr: string;
  result_xdr: string;
  result_meta_xdr: string;
  successful: boolean;
  _links: Record<string, any>;
}

export interface HorizonLedger {
  id: string;
  paging_token: string;
  sequence: number;
  hash: string;
  prev_hash: string;
  timestamp: string;
  transaction_count: number;
  operation_count: number;
  closed_at: string;
  total_coins: string;
  fee_pool: string;
  base_fee_in_stroops: number;
  base_reserve_in_stroops: number;
  max_tx_set_size: number;
  protocol_version: number;
  _links: Record<string, any>;
}

export interface HorizonAsset {
  asset_type: string;
  asset_code: string;
  asset_issuer: string;
  paging_token: string;
  accounts: {
    authorized: number;
    authorized_to_maintain_liabilities: number;
    unauthorized: number;
  };
  balances: {
    authorized: string;
    authorized_to_maintain_liabilities: string;
    unauthorized: string;
  };
  clawback_enabled: boolean;
  num_accounts: number;
  num_claimable_balances: number;
  num_liquidity_pools: number;
  num_trustlines: number;
  amount: string;
  flags: {
    auth_required: boolean;
    auth_revocable: boolean;
    auth_immutable: boolean;
  };
  _links: Record<string, any>;
}

export interface HorizonOrderBook {
  bids: Array<{
    price: string;
    amount: string;
    price_r: {
      n: number;
      d: number;
    };
  }>;
  asks: Array<{
    price: string;
    amount: string;
    price_r: {
      n: number;
      d: number;
    };
  }>;
  base: {
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  };
  counter: {
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  };
}

export interface HorizonError {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
}

/**
 * Mock Horizon API responses
 */
export class MockHorizon {
  private accounts: Map<string, HorizonAccount> = new Map();
  private transactions: Map<string, HorizonTransaction> = new Map();
  private ledgers: Map<number, HorizonLedger> = new Map();
  private assets: Map<string, HorizonAsset> = new Map();
  private orderBooks: Map<string, HorizonOrderBook> = new Map();
  private shouldFail: boolean = false;
  private failureError: HorizonError | null = null;

  /**
   * Mock account endpoint
   */
  mockAccount(accountId: string, overrides?: Partial<HorizonAccount>): HorizonAccount {
    const account: HorizonAccount = {
      id: accountId,
      account_id: accountId,
      balances: [
        {
          balance: '1000.0000000',
          asset_type: 'native',
        },
      ],
      sequence: '1',
      subentry_count: 0,
      last_modified_ledger: 1000,
      last_modified_time: new Date().toISOString(),
      thresholds: {
        low_threshold: 0,
        med_threshold: 0,
        high_threshold: 0,
      },
      flags: {
        auth_required: false,
        auth_revocable: false,
        auth_immutable: false,
      },
      signers: [
        {
          weight: 1,
          key: accountId,
          type: 'ed25519_public_key',
        },
      ],
      data: {},
      _links: {
        self: { href: `https://horizon.stellar.org/accounts/${accountId}` },
        transactions: { href: `https://horizon.stellar.org/accounts/${accountId}/transactions` },
        operations: { href: `https://horizon.stellar.org/accounts/${accountId}/operations` },
      },
      ...overrides,
    };

    this.accounts.set(accountId, account);
    return account;
  }

  /**
   * Mock transaction endpoint
   */
  mockTransaction(
    hash: string,
    overrides?: Partial<HorizonTransaction>
  ): HorizonTransaction {
    const transaction: HorizonTransaction = {
      id: hash,
      paging_token: `${Date.now()}-0`,
      hash,
      ledger: 1000,
      created_at: new Date().toISOString(),
      source_account: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7UYXNMWX5XNXNXNXNXN',
      source_account_sequence: '1',
      fee_charged: '100',
      max_fee: '100',
      operation_count: 1,
      envelope_xdr: 'AAAAAgAAAABb8PsSeJ2XH7dDrHV6I90DH2eDBFezq92rLvdUesFGzgAAAGQADKQ7',
      result_xdr: 'AAAAAAAAAGQAAAAAAAAAAA==',
      result_meta_xdr: 'AAAAAgAAAAA=',
      successful: true,
      _links: {
        self: { href: `https://horizon.stellar.org/transactions/${hash}` },
        account: { href: `https://horizon.stellar.org/accounts/GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7UYXNMWX5XNXNXNXNXN` },
      },
      ...overrides,
    };

    this.transactions.set(hash, transaction);
    return transaction;
  }

  /**
   * Mock ledger endpoint
   */
  mockLedger(sequence: number, overrides?: Partial<HorizonLedger>): HorizonLedger {
    const ledger: HorizonLedger = {
      id: `${sequence}`,
      paging_token: `${sequence}`,
      sequence,
      hash: `0000000000000000000000000000000000000000000000000000000000000${sequence}`,
      prev_hash: `0000000000000000000000000000000000000000000000000000000000000${sequence - 1}`,
      timestamp: new Date().toISOString(),
      transaction_count: 10,
      operation_count: 50,
      closed_at: new Date().toISOString(),
      total_coins: '50000000000.0000000',
      fee_pool: '1000.0000000',
      base_fee_in_stroops: 100,
      base_reserve_in_stroops: 5000000,
      max_tx_set_size: 1000,
      protocol_version: 20,
      _links: {
        self: { href: `https://horizon.stellar.org/ledgers/${sequence}` },
        transactions: { href: `https://horizon.stellar.org/ledgers/${sequence}/transactions` },
      },
      ...overrides,
    };

    this.ledgers.set(sequence, ledger);
    return ledger;
  }

  /**
   * Mock asset endpoint
   */
  mockAsset(
    assetCode: string,
    assetIssuer: string,
    overrides?: Partial<HorizonAsset>
  ): HorizonAsset {
    const key = `${assetCode}:${assetIssuer}`;
    const asset: HorizonAsset = {
      asset_type: 'credit_alphanum12',
      asset_code: assetCode,
      asset_issuer: assetIssuer,
      paging_token: key,
      accounts: {
        authorized: 1000,
        authorized_to_maintain_liabilities: 100,
        unauthorized: 10,
      },
      balances: {
        authorized: '1000000.0000000',
        authorized_to_maintain_liabilities: '100000.0000000',
        unauthorized: '0.0000000',
      },
      clawback_enabled: false,
      num_accounts: 1110,
      num_claimable_balances: 50,
      num_liquidity_pools: 10,
      num_trustlines: 1110,
      amount: '1100000.0000000',
      flags: {
        auth_required: false,
        auth_revocable: false,
        auth_immutable: false,
      },
      _links: {
        self: { href: `https://horizon.stellar.org/assets?asset_code=${assetCode}&asset_issuer=${assetIssuer}` },
      },
      ...overrides,
    };

    this.assets.set(key, asset);
    return asset;
  }

  /**
   * Mock order book endpoint
   */
  mockOrderBook(
    baseAsset: { code: string; issuer: string },
    counterAsset: { code: string; issuer: string },
    overrides?: Partial<HorizonOrderBook>
  ): HorizonOrderBook {
    const key = `${baseAsset.code}:${baseAsset.issuer}:${counterAsset.code}:${counterAsset.issuer}`;
    const orderBook: HorizonOrderBook = {
      bids: [
        {
          price: '0.5000000',
          amount: '1000.0000000',
          price_r: { n: 1, d: 2 },
        },
        {
          price: '0.4500000',
          amount: '2000.0000000',
          price_r: { n: 9, d: 20 },
        },
      ],
      asks: [
        {
          price: '0.5500000',
          amount: '1500.0000000',
          price_r: { n: 11, d: 20 },
        },
        {
          price: '0.6000000',
          amount: '2500.0000000',
          price_r: { n: 3, d: 5 },
        },
      ],
      base: {
        asset_type: 'credit_alphanum12',
        asset_code: baseAsset.code,
        asset_issuer: baseAsset.issuer,
      },
      counter: {
        asset_type: 'credit_alphanum12',
        asset_code: counterAsset.code,
        asset_issuer: counterAsset.issuer,
      },
      ...overrides,
    };

    this.orderBooks.set(key, orderBook);
    return orderBook;
  }

  /**
   * Get mocked account
   */
  getAccount(accountId: string): HorizonAccount | undefined {
    return this.accounts.get(accountId);
  }

  /**
   * Get mocked transaction
   */
  getTransaction(hash: string): HorizonTransaction | undefined {
    return this.transactions.get(hash);
  }

  /**
   * Get mocked ledger
   */
  getLedger(sequence: number): HorizonLedger | undefined {
    return this.ledgers.get(sequence);
  }

  /**
   * Get mocked asset
   */
  getAsset(assetCode: string, assetIssuer: string): HorizonAsset | undefined {
    return this.assets.get(`${assetCode}:${assetIssuer}`);
  }

  /**
   * Get mocked order book
   */
  getOrderBook(
    baseAsset: { code: string; issuer: string },
    counterAsset: { code: string; issuer: string }
  ): HorizonOrderBook | undefined {
    const key = `${baseAsset.code}:${baseAsset.issuer}:${counterAsset.code}:${counterAsset.issuer}`;
    return this.orderBooks.get(key);
  }

  /**
   * Simulate API failure
   */
  simulateFailure(error: HorizonError): void {
    this.shouldFail = true;
    this.failureError = error;
  }

  /**
   * Clear failure simulation
   */
  clearFailure(): void {
    this.shouldFail = false;
    this.failureError = null;
  }

  /**
   * Check if should fail
   */
  isFailing(): boolean {
    return this.shouldFail;
  }

  /**
   * Get failure error
   */
  getFailureError(): HorizonError | null {
    return this.failureError;
  }

  /**
   * Reset all mocks
   */
  reset(): void {
    this.accounts.clear();
    this.transactions.clear();
    this.ledgers.clear();
    this.assets.clear();
    this.orderBooks.clear();
    this.shouldFail = false;
    this.failureError = null;
  }

  /**
   * Get all mocked data
   */
  getAllMocks() {
    return {
      accounts: Array.from(this.accounts.values()),
      transactions: Array.from(this.transactions.values()),
      ledgers: Array.from(this.ledgers.values()),
      assets: Array.from(this.assets.values()),
      orderBooks: Array.from(this.orderBooks.values()),
    };
  }
}

/**
 * Factory function to create mock instance
 */
export function mockHorizon(): MockHorizon {
  return new MockHorizon();
}

/**
 * Common error scenarios
 */
export const HORIZON_ERRORS = {
  NOT_FOUND: {
    type: 'https://stellar.org/horizon-errors/not_found',
    title: 'Resource Missing',
    status: 404,
    detail: 'The resource at the url requested was not found.',
  },
  RATE_LIMIT: {
    type: 'https://stellar.org/horizon-errors/rate_limit_exceeded',
    title: 'Rate Limit Exceeded',
    status: 429,
    detail: 'The request rate limit has been exceeded.',
  },
  INVALID_REQUEST: {
    type: 'https://stellar.org/horizon-errors/invalid_request',
    title: 'Invalid Request',
    status: 400,
    detail: 'The request you sent was invalid in some way.',
  },
  INTERNAL_ERROR: {
    type: 'https://stellar.org/horizon-errors/internal_error',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An internal server error occurred.',
  },
  SERVICE_UNAVAILABLE: {
    type: 'https://stellar.org/horizon-errors/service_unavailable',
    title: 'Service Unavailable',
    status: 503,
    detail: 'The Horizon server is temporarily unavailable.',
  },
};
