# Stellar Account Creation Workflow

This document describes the process of creating and activating a Stellar account on the network.

## 1. Keypair Generation

A Stellar account starts with a cryptographic keypair consisting of:
- **Public Key**: Starts with `G`, used as the account ID (e.g., `GABC...`).
- **Secret Key**: Starts with `S`, used to sign transactions (e.g., `SXYZ...`).

```typescript
import { Keypair } from 'stellar-sdk';

const kp = Keypair.random();
console.log('Public Key:', kp.publicKey());
console.log('Secret Key:', kp.secret());
```

## 2. Account Funding (Activation)

Generating a keypair does not create an account on the Stellar network. To exist on the network, an account must be funded with at least the **minimum balance**.

### Funding Mechanism
- **Mainnet**: An existing account must send XLM to the new public key using the `Create Account` operation.
- **Testnet**: Use **Friendbot**, a free service that funds accounts with 10,000 XLM.

```bash
# Fund via Friendbot on Testnet
curl "https://friendbot.stellar.org?addr=PUBLIC_KEY"
```

## 3. Minimum Balance Rules

Stellar has a minimum balance requirement to prevent ledger bloat.

- **Base Reserve**: 0.5 XLM.
- **Minimum Balance**: `(2 + number_of_entries) * base_reserve`.
- For a new account with no sub-entries (trustlines, offers, etc.), the minimum balance is **1 XLM** (2 * 0.5).

## 4. Account Activation Checks

Once funded, the account:
- Has an entry in the ledger.
- Has a starting **sequence number** (equal to the ledger number it was created in).
- Can perform transactions.

## 5. Common Failure Scenarios

| Scenario | Cause | Resolution |
| :--- | :--- | :--- |
| **Account Not Found** | Account has not been funded yet. | Send at least 1 XLM to the account. |
| **op_low_reserve** | Transaction would drop balance below minimum. | Add more XLM to the account. |
| **Invalid Address** | Public key is malformed or has wrong checksum. | Verify public key format. |
| **Friendbot Busy** | Too many requests to the testnet funding service. | Implement retries with exponential backoff. |
| **Horizon Unavailable** | Network connectivity issues or node maintenance. | Check network status or use a different Horizon endpoint. |
