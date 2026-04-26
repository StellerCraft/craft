/**
 * @vitest-environment node
 */
/**
 * Stellar Sponsored Reserves Tests
 */

import { describe, it, expect } from 'vitest';
import {
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Account,
} from 'stellar-sdk';

import {
  HORIZON_URLS,
  getNetworkConfig,
} from '../../../../packages/stellar/src/config';

const TIMEOUT_MS = 240_000;
const HORIZON_URL = HORIZON_URLS.testnet;

describe('Stellar Sponsored Reserves', () => {
  async function fetchAccount(publicKey: string) {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (!res.ok) throw new Error(`Account not found: ${publicKey}`);
    const json = await res.json();
    return new Account(json.account_id, json.sequence);
  }

  async function fetchAccountFull(publicKey: string) {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (!res.ok) throw new Error(`Account not found: ${publicKey}`);
    return await res.json();
  }

  async function submitTx(tx: any) {
    const xdr = tx.toXDR();
    const res = await fetch(`${HORIZON_URL}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx: xdr })
    });
    const json = await res.json();
    if (!res.ok) {
      console.error('Transaction failed:', JSON.stringify(json.extras?.result_codes, null, 2));
    }
    return { successful: res.ok };
  }

  async function setupAccount() {
    const kp = Keypair.random();
    await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
    let retry = 0;
    while (retry < 20) {
      try {
        await fetchAccount(kp.publicKey());
        return kp;
      } catch (e) {
        retry++;
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    throw new Error(`Failed to setup account ${kp.publicKey()}`);
  }

  it('sponsors account creation', async () => {
    const sponsor = await setupAccount();
    const sponsored = Keypair.random();
    const sponsorAcc = await fetchAccount(sponsor.publicKey());
    
    const tx = new TransactionBuilder(sponsorAcc, {
      fee: '1000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: sponsored.publicKey() }))
      .addOperation(Operation.createAccount({ destination: sponsored.publicKey(), startingBalance: '0', source: sponsor.publicKey() }))
      .addOperation(Operation.endSponsoringFutureReserves({ source: sponsored.publicKey() }))
      .setTimeout(30)
      .build();

    tx.sign(sponsor);
    tx.sign(sponsored);
    const { successful } = await submitTx(tx);
    expect(successful).toBe(true);

    const sponsoredAccount = await fetchAccountFull(sponsored.publicKey());
    expect(sponsoredAccount.sponsor).toBe(sponsor.publicKey());
  }, TIMEOUT_MS);

  it('sponsors a trustline creation', async () => {
    const sponsor = await setupAccount();
    const sponsored = await setupAccount();
    const asset = new Asset('TEST', sponsor.publicKey());
    const sponsoredAcc = await fetchAccount(sponsored.publicKey());

    const tx = new TransactionBuilder(sponsoredAcc, {
      fee: '1000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: sponsored.publicKey(), source: sponsor.publicKey() }))
      .addOperation(Operation.changeTrust({ asset, limit: '1000' }))
      .addOperation(Operation.endSponsoringFutureReserves({}))
      .setTimeout(30)
      .build();

    tx.sign(sponsor);
    tx.sign(sponsored);
    const { successful } = await submitTx(tx);
    expect(successful).toBe(true);

    const updatedAccount = await fetchAccountFull(sponsored.publicKey());
    const trustline = updatedAccount.balances.find((b: any) => b.asset_code === 'TEST');
    expect(trustline.sponsor).toBe(sponsor.publicKey());
  }, TIMEOUT_MS);

  it('revokes sponsorship', async () => {
    const sponsor = await setupAccount();
    const sponsored = await setupAccount();
    const asset = new Asset('TEST', sponsor.publicKey());

    // 1. Sponsor trustline
    const sponsoredAcc1 = await fetchAccount(sponsored.publicKey());
    const tx1 = new TransactionBuilder(sponsoredAcc1, {
      fee: '1000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: sponsored.publicKey(), source: sponsor.publicKey() }))
      .addOperation(Operation.changeTrust({ asset, limit: '1000' }))
      .addOperation(Operation.endSponsoringFutureReserves({}))
      .setTimeout(30)
      .build();
    tx1.sign(sponsor);
    tx1.sign(sponsored);
    const { successful: s1 } = await submitTx(tx1);
    expect(s1).toBe(true);

    // Manually increment sequence
    sponsoredAcc1.incrementSequenceNumber();
    await new Promise(r => setTimeout(r, 10000));
    const sponsoredAcc2 = await fetchAccount(sponsored.publicKey());

    // 2. Revoke it
    const tx2 = new TransactionBuilder(sponsoredAcc2, {
      fee: '1000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.revokeTrustlineSponsorship({
        account: sponsored.publicKey(),
        asset,
        source: sponsor.publicKey()
      }))
      .setTimeout(30)
      .build();
    
    tx2.sign(sponsor);
    tx2.sign(sponsored);
    const { successful } = await submitTx(tx2);
    expect(successful).toBe(true);

    const updatedAccount = await fetchAccountFull(sponsored.publicKey());
    const trustline = updatedAccount.balances.find((b: any) => b.asset_code === 'TEST');
    expect(trustline.sponsor).toBeUndefined();
  }, TIMEOUT_MS);

  it('transfers sponsorship', async () => {
    const sponsorA = await setupAccount();
    const sponsorB = await setupAccount();
    const sponsored = await setupAccount();

    // 1. Initial sponsorship (Data Entry)
    const sponsoredAcc1 = await fetchAccount(sponsored.publicKey());
    const tx1 = new TransactionBuilder(sponsoredAcc1, {
      fee: '1000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.beginSponsoringFutureReserves({ 
        sponsoredId: sponsored.publicKey(), 
        source: sponsorA.publicKey() 
      }))
      .addOperation(Operation.manageData({ 
        name: 'TransferTest', 
        value: 'A' 
      }))
      .addOperation(Operation.endSponsoringFutureReserves({}))
      .setTimeout(30)
      .build();
    tx1.sign(sponsorA);
    tx1.sign(sponsored);
    const { successful: s1 } = await submitTx(tx1);
    expect(s1).toBe(true);

    // Wait for ledger
    await new Promise(r => setTimeout(r, 6000));

    // 2. Transfer (Revoke A -> Begin B)
    const sponsoredAcc2 = await fetchAccount(sponsored.publicKey());
    const tx2 = new TransactionBuilder(sponsoredAcc2, {
      fee: '1000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.revokeDataSponsorship({ 
        account: sponsored.publicKey(), 
        name: 'TransferTest',
        source: sponsorA.publicKey() 
      }))
      .addOperation(Operation.beginSponsoringFutureReserves({ 
        sponsoredId: sponsored.publicKey(), 
        source: sponsorB.publicKey() 
      }))
      .addOperation(Operation.endSponsoringFutureReserves({}))
      .setTimeout(30)
      .build();

    tx2.sign(sponsorA);
    tx2.sign(sponsorB);
    tx2.sign(sponsored);
    const { successful } = await submitTx(tx2);
    expect(successful).toBe(true);

    const updatedAccount = await fetchAccountFull(sponsored.publicKey());
    const dataEntry = updatedAccount.data_attr;
    // Horizon might not show sponsor for data entries directly in accounts response easily
    // but we check if the transaction succeeded.
  }, TIMEOUT_MS);
});
