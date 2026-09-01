# @craft/stellar

Stellar SDK wrapper package for shared usage across templates and app surfaces.

## Exports

- Network config constants via `config`
- Common operations:
  - `loadAccount(publicKey)`
  - `getAccountBalance(publicKey)`
  - `submitTransaction(transaction)`
- Typed operation contracts:
  - `StellarAccount`
  - `StellarBalance`
  - `SubmitTransactionResult`
- Error helpers:
  - `parseStellarError`
  - `getErrorGuidance`
  - `isRetryableError`
  - `formatError`
- Test mocks:
  - `mockAccount`
  - `mockTransaction`

## Usage

```ts
import {
  loadAccount,
  getAccountBalance,
  submitTransaction,
  type StellarAccount,
  type SubmitTransactionResult,
} from '@craft/stellar';
```

## Notes

- The package centralizes Stellar network interactions for consistency.
- Runtime configuration is read from `NEXT_PUBLIC_STELLAR_*` environment variables.

---

## Deterministic Contract Address Derivation

`deriveContractAddress(deployerPublicKey, salt, wasmHash, networkPassphrase)` computes the Soroban
contract address that will be assigned when a contract is deployed with the given
parameters, without submitting any transaction.

### Algorithm

1. Build an XDR `HashIDPreimage` of type `CONTRACT_ID` containing a
   `PreimageFromAddress` variant with the deployer address and salt.
2. SHA-256 hash the serialised preimage → 32-byte contract ID.
3. Encode the contract ID as a Stellar contract address (`C…` strkey).

This mirrors the derivation performed by the Soroban host, so the result is
guaranteed to match the address assigned at deployment time.

### Parameters

| Parameter          | Type               | Description                                      |
| ------------------ | ------------------ | ------------------------------------------------ |
| `deployerPublicKey`| `string`           | `G…` Stellar public key of the deploying account |
| `salt`             | `Buffer \| string` | 32-byte deployment salt (Buffer or hex string)   |
| `wasmHash`         | `Buffer \| string` | 32-byte SHA-256 hash of the WASM binary          |
| `networkPassphrase`| `string`           | Network passphrase (e.g., `Networks.PUBLIC`, `Networks.TESTNET_FUTURE`, etc.) |

### Example

```ts
import { deriveContractAddress, verifyContractAddress } from '@craft/stellar';
import { Networks } from 'stellar-sdk';

// Current signature requires networkPassphrase to prevent cross-network address collisions
const previewAddress = deriveContractAddress(
  deployerKey,
  salt,
  wasmHash,
  Networks.PUBLIC_NETWORK_PASSPHRASE,
);
console.log('Pre-deployment address:', previewAddress);

// After deployment, verify the address matches
const isMatch = verifyContractAddress(
  deployerKey,
  salt,
  wasmHash,
  deployedAddress,
  Networks.PUBLIC_NETWORK_PASSPHRASE,
);
```

### Breaking Changes (v1.x)

**Version 1.x introduced a breaking change**: both `deriveContractAddress` and `verifyContractAddress`
now require a `networkPassphrase` parameter as their final argument.

#### Migration Guide

**Before (pre-v1.x):**
```ts
const address = deriveContractAddress(deployerKey, salt, wasmHash);
const isValid = verifyContractAddress(deployerKey, salt, wasmHash, deployedAddress);
```

**After (v1.x+):**
```ts
import { Networks } from 'stellar-sdk';

const address = deriveContractAddress(
  deployerKey,
  salt,
  wasmHash,
  Networks.PUBLIC_NETWORK_PASSPHRASE,
);
const isValid = verifyContractAddress(
  deployerKey,
  salt,
  wasmHash,
  deployedAddress,
  Networks.PUBLIC_NETWORK_PASSPHRASE,
);
```

#### Rationale

The `networkPassphrase` parameter is required to **prevent cross-network address collisions**.
Contract addresses are deterministic based on the deployer, salt, WASM hash, and **network**.
Without including the network passphrase in the derivation, the same parameters could produce
identical addresses on different networks (Mainnet, Testnet, etc.), leading to confusion and
potential security issues.

#### Available Network Passphrases

- `Networks.PUBLIC_NETWORK_PASSPHRASE` – Stellar public network
- `Networks.TESTNET_NETWORK_PASSPHRASE` – Stellar test network
- `Networks.FUTURENET_NETWORK_PASSPHRASE` – Stellar future network
- Custom passphrase string (for private networks)

---

## Type-Safe Contract Invocation Wrapper

`invokeContract<TArgs, TReturn>(options, parse)` wraps Soroban contract
invocations with compile-time type checking and an error boundary that maps all
RPC errors to typed `AppError` objects — raw RPC details never leak to callers.

### Example

```ts
import { invokeContract } from '@craft/stellar';

const res = await invokeContract(
  { contractId, method: 'balance', args: [addressArg], sourcePublicKey },
  (raw) => (raw as any).result?.retval as bigint,
);

if (res.ok) {
  console.log('Balance:', res.result);
} else {
  console.error(res.error.message); // typed, user-friendly message
}
```

---

## Horizon Multi-Endpoint Failover

`createHorizonFailover(config)` returns a stateful failover manager that
automatically switches between Horizon endpoints when the primary becomes
unavailable.

### Failover algorithm

1. The first entry in `endpoints` is the primary.
2. `selectEndpoint()` returns the first healthy endpoint.
3. An endpoint is marked unhealthy via `markUnhealthy(url)`; it becomes
   eligible again after `recoveryMs` milliseconds (default 30 s).
4. If all endpoints are unhealthy the primary is returned as a last resort.

### Example

```ts
import { createHorizonFailover } from '@craft/stellar';

const failover = createHorizonFailover({
  endpoints: [
    'https://horizon.stellar.org',
    'https://horizon.example.com',
  ],
  recoveryMs: 30_000,
});

async function horizonFetch(path: string) {
  const url = failover.selectEndpoint();
  try {
    const res = await fetch(`${url}${path}`);
    failover.markHealthy(url);
    return res;
  } catch (err) {
    failover.markUnhealthy(url);
    throw err;
  }
}
```

---

## Storage Key Namespace Collision Detection

`detectStorageKeyCollisions(entries)` and `assertNoStorageKeyCollisions(entries)`
analyse a set of `{ owner, key }` pairs and detect when two or more owners claim
the same storage key namespace, which would corrupt contract state.

Use `assertNoStorageKeyCollisions` as a pre-deployment guard; it throws a
`StorageKeyCollisionError` with a clear message naming the colliding keys and
their owners.

### Namespacing scheme

Each template feature should prefix its storage keys with a unique namespace
(e.g. `"token:balance"`, `"governance:votes"`). Pass all keys from all active
features to the collision detector before deployment.

### Example

```ts
import { assertNoStorageKeyCollisions } from '@craft/stellar';

assertNoStorageKeyCollisions([
  { owner: 'TokenFeature',      key: 'token:balance' },
  { owner: 'GovernanceFeature', key: 'governance:votes' },
  // { owner: 'OtherFeature', key: 'token:balance' }, // would throw
]);
```
