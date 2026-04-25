# Stellar Horizon API Mocking Framework

This document describes the comprehensive mocking framework for Stellar Horizon API, enabling offline testing and development without network dependencies.

## Overview

The Stellar Horizon mocking framework provides:

- Mock implementations of all commonly used Horizon API endpoints
- Realistic response data matching actual Horizon API format
- Error scenario simulation for testing error handling
- Offline development and testing capabilities
- Type-safe mock data with TypeScript interfaces

## Installation

The mocking framework is included in the test utilities:

```typescript
import { mockHorizon, HORIZON_ERRORS } from '@/tests/mocks/stellar-horizon.mock';
```

## Basic Usage

### Creating a Mock Instance

```typescript
import { mockHorizon } from '@/tests/mocks/stellar-horizon.mock';

const mock = mockHorizon();
```

### Mocking Accounts

```typescript
const accountId = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7UYXNMWX5XNXNXNXNXN';

// Create mock account with defaults
const account = mock.mockAccount(accountId);

// Create mock account with custom data
const customAccount = mock.mockAccount(accountId, {
  sequence: '100',
  balances: [
    {
      balance: '5000.0000000',
      asset_type: 'native',
    },
    {
      balance: '1000.0000000',
      asset_type: 'credit_alphanum12',
      asset_code: 'USDC',
      asset_issuer: 'GBBD47UZQ5SYWDRFGUTDJWEB5QCSTX3UNAWXE2VOHYMWTKWTOA5XUSEA',
    },
  ],
});

// Retrieve mocked account
const retrieved = mock.getAccount(accountId);
```

### Mocking Transactions

```typescript
const txHash = 'abc123def456';

// Create mock transaction
const transaction = mock.mockTransaction(txHash, {
  successful: true,
  operation_count: 2,
  fee_charged: '200',
});

// Retrieve mocked transaction
const retrieved = mock.getTransaction(txHash);
```

### Mocking Ledgers

```typescript
// Create mock ledger
const ledger = mock.mockLedger(1000, {
  transaction_count: 50,
  operation_count: 200,
});

// Retrieve mocked ledger
const retrieved = mock.getLedger(1000);
```

### Mocking Assets

```typescript
const assetCode = 'USDC';
const assetIssuer = 'GBBD47UZQ5SYWDRFGUTDJWEB5QCSTX3UNAWXE2VOHYMWTKWTOA5XUSEA';

// Create mock asset
const asset = mock.mockAsset(assetCode, assetIssuer, {
  num_accounts: 5000,
  amount: '10000000.0000000',
});

// Retrieve mocked asset
const retrieved = mock.getAsset(assetCode, assetIssuer);
```

### Mocking Order Books

```typescript
const baseAsset = { code: 'USDC', issuer: 'GBBD47UZQ5SYWDRFGUTDJWEB5QCSTX3UNAWXE2VOHYMWTKWTOA5XUSEA' };
const counterAsset = { code: 'EUR', issuer: 'GCQPYGH4K57XZMBNECCRQAE5STNRNRQGNNZPQWXNZMOTXP3P4UYXF7D' };

// Create mock order book
const orderBook = mock.mockOrderBook(baseAsset, counterAsset, {
  bids: [
    {
      price: '0.95',
      amount: '10000.0000000',
      price_r: { n: 19, d: 20 },
    },
  ],
  asks: [
    {
      price: '1.05',
      amount: '5000.0000000',
      price_r: { n: 21, d: 20 },
    },
  ],
});

// Retrieve mocked order book
const retrieved = mock.getOrderBook(baseAsset, counterAsset);
```

## Error Scenario Simulation

### Simulating Failures

```typescript
import { HORIZON_ERRORS } from '@/tests/mocks/stellar-horizon.mock';

// Simulate not found error
mock.simulateFailure(HORIZON_ERRORS.NOT_FOUND);

// Check if failing
if (mock.isFailing()) {
  const error = mock.getFailureError();
  console.log(error.status); // 404
}

// Clear failure
mock.clearFailure();
```

### Available Error Scenarios

```typescript
// 404 Not Found
HORIZON_ERRORS.NOT_FOUND

// 429 Rate Limit Exceeded
HORIZON_ERRORS.RATE_LIMIT

// 400 Invalid Request
HORIZON_ERRORS.INVALID_REQUEST

// 500 Internal Server Error
HORIZON_ERRORS.INTERNAL_ERROR

// 503 Service Unavailable
HORIZON_ERRORS.SERVICE_UNAVAILABLE
```

## Testing Patterns

### Unit Test Example

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockHorizon } from '@/tests/mocks/stellar-horizon.mock';

describe('Stellar Account Service', () => {
  let mock: ReturnType<typeof mockHorizon>;

  beforeEach(() => {
    mock = mockHorizon();
  });

  it('should fetch account details', () => {
    const accountId = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7UYXNMWX5XNXNXNXNXN';
    mock.mockAccount(accountId);

    const account = mock.getAccount(accountId);
    expect(account).toBeDefined();
    expect(account?.account_id).toBe(accountId);
  });

  it('should handle account not found', () => {
    const accountId = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7UYXNMWX5XNXNXNXNXN';
    
    const account = mock.getAccount(accountId);
    expect(account).toBeUndefined();
  });
});
```

### Integration Test Example

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockHorizon, HORIZON_ERRORS } from '@/tests/mocks/stellar-horizon.mock';

describe('DEX Trading Flow', () => {
  let mock: ReturnType<typeof mockHorizon>;

  beforeEach(() => {
    mock = mockHorizon();
  });

  it('should complete trading flow', () => {
    // Setup mock data
    const accountId = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7UYXNMWX5XNXNXNXNXN';
    mock.mockAccount(accountId, {
      balances: [
        { balance: '1000.0000000', asset_type: 'native' },
        {
          balance: '500.0000000',
          asset_type: 'credit_alphanum12',
          asset_code: 'USDC',
          asset_issuer: 'GBBD47UZQ5SYWDRFGUTDJWEB5QCSTX3UNAWXE2VOHYMWTKWTOA5XUSEA',
        },
      ],
    });

    const baseAsset = { code: 'USDC', issuer: 'GBBD47UZQ5SYWDRFGUTDJWEB5QCSTX3UNAWXE2VOHYMWTKWTOA5XUSEA' };
    const counterAsset = { code: 'EUR', issuer: 'GCQPYGH4K57XZMBNECCRQAE5STNRNRQGNNZPQWXNZMOTXP3P4UYXF7D' };
    mock.mockOrderBook(baseAsset, counterAsset);

    // Test trading logic
    const account = mock.getAccount(accountId);
    const orderBook = mock.getOrderBook(baseAsset, counterAsset);

    expect(account?.balances).toHaveLength(2);
    expect(orderBook?.bids).toBeDefined();
  });

  it('should handle rate limit errors', () => {
    mock.simulateFailure(HORIZON_ERRORS.RATE_LIMIT);

    expect(mock.isFailing()).toBe(true);
    expect(mock.getFailureError()?.status).toBe(429);
  });
});
```

## Mock Data Fixtures

### Realistic Account Data

```typescript
const realisticAccount = mock.mockAccount(accountId, {
  sequence: '1000',
  subentry_count: 5,
  home_domain: 'example.com',
  balances: [
    {
      balance: '1000.0000000',
      asset_type: 'native',
    },
    {
      balance: '500.0000000',
      asset_type: 'credit_alphanum12',
      asset_code: 'USDC',
      asset_issuer: 'GBBD47UZQ5SYWDRFGUTDJWEB5QCSTX3UNAWXE2VOHYMWTKWTOA5XUSEA',
    },
  ],
  flags: {
    auth_required: true,
    auth_revocable: false,
    auth_immutable: false,
  },
  signers: [
    {
      weight: 1,
      key: accountId,
      type: 'ed25519_public_key',
    },
    {
      weight: 1,
      key: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7UYXNMWX5XNXNXNXNXN',
      type: 'ed25519_public_key',
    },
  ],
});
```

### Realistic Transaction Data

```typescript
const realisticTransaction = mock.mockTransaction(txHash, {
  successful: true,
  operation_count: 3,
  fee_charged: '300',
  max_fee: '300',
  source_account: accountId,
  source_account_sequence: '1000',
  created_at: new Date().toISOString(),
});
```

## Resetting Mocks

### Clear All Mocks

```typescript
mock.reset();
```

### Get All Mocked Data

```typescript
const allMocks = mock.getAllMocks();
console.log(allMocks.accounts);
console.log(allMocks.transactions);
console.log(allMocks.ledgers);
console.log(allMocks.assets);
console.log(allMocks.orderBooks);
```

## Best Practices

### 1. Use beforeEach for Test Isolation

```typescript
beforeEach(() => {
  mock = mockHorizon();
});
```

### 2. Create Realistic Test Data

```typescript
// Good: Realistic data
mock.mockAccount(accountId, {
  sequence: '1000',
  balances: [
    { balance: '1000.0000000', asset_type: 'native' },
    { balance: '500.0000000', asset_type: 'credit_alphanum12', asset_code: 'USDC', asset_issuer: '...' },
  ],
});

// Avoid: Minimal data
mock.mockAccount(accountId);
```

### 3. Test Error Scenarios

```typescript
it('should handle network errors', () => {
  mock.simulateFailure(HORIZON_ERRORS.SERVICE_UNAVAILABLE);
  // Test error handling
});
```

### 4. Verify Mock Data

```typescript
it('should use mocked data', () => {
  const account = mock.mockAccount(accountId, { sequence: '500' });
  const retrieved = mock.getAccount(accountId);
  
  expect(retrieved?.sequence).toBe('500');
});
```

## Limitations

- Mocks do not validate Stellar protocol rules
- No transaction submission simulation
- No real cryptographic operations
- No network latency simulation
- Limited to predefined response structures

## Related Documentation

- [Testing Guide](./testing.md)
- [Stellar SDK Documentation](https://developers.stellar.org/docs)
- [Horizon API Reference](https://developers.stellar.org/api/introduction/index.html)
