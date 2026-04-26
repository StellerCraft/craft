/**
 * Stellar Payment Channel Tests
 *
 * Verifies payment channel lifecycle: creation, funding, off-chain transactions,
 * cooperative closure, and dispute resolution.
 *
 * No live network connection required — all Stellar operations are simulated
 * in-memory using deterministic keypairs and a mock ledger.
 *
 * Payment channel model (documented):
 *   1. Two parties (initiator + responder) create a 2-of-2 multisig escrow account.
 *   2. Initiator funds the escrow; both parties sign a funding transaction.
 *   3. Off-chain transactions update balances via signed sequence-number bumps.
 *   4. Cooperative close: both sign a closing transaction distributing final balances.
 *   5. Dispute: either party broadcasts the latest signed state; a timelock prevents
 *      the counterparty from submitting a stale state after the dispute window.
 *
 * Stellar specifics:
 *   - Sequence numbers must be strictly increasing.
 *   - Minimum balance per account: 1 XLM base + 0.5 XLM per subentry.
 *   - Timelock implemented via TimeBounds (minTime / maxTime) on transactions.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────

const STROOP = 1;
const XLM = 10_000_000; // stroops per XLM
const MIN_BALANCE_STROOPS = 1 * XLM;
const BASE_FEE_STROOPS = 100;
const DISPUTE_WINDOW_SECONDS = 60 * 60 * 24; // 24 h

// ── Types ─────────────────────────────────────────────────────────────────────

type ChannelStatus = 'pending' | 'open' | 'closing' | 'closed' | 'disputed';

interface Keypair {
  publicKey: string;
  secretKey: string;
}

interface ChannelState {
  sequenceNumber: number;
  initiatorBalance: number; // stroops
  responderBalance: number; // stroops
  signatures: string[];
}

interface PaymentChannel {
  id: string;
  escrowPublicKey: string;
  initiator: Keypair;
  responder: Keypair;
  status: ChannelStatus;
  fundingAmount: number; // stroops
  states: ChannelState[];
  disputeDeadline?: number; // unix timestamp
}

interface MockLedger {
  accounts: Map<string, { balance: number; sequenceNumber: number }>;
  transactions: Array<{ id: string; from: string; to: string; amount: number; fee: number }>;
}

// ── Implementation ────────────────────────────────────────────────────────────

let _keyCounter = 0;
function generateKeypair(seed?: string): Keypair {
  const id = seed ?? `key_${++_keyCounter}`;
  return { publicKey: `G${id.toUpperCase().padEnd(55, '0')}`, secretKey: `S${id.toUpperCase().padEnd(55, '0')}` };
}

function createMockLedger(): MockLedger {
  return { accounts: new Map(), transactions: [] };
}

function fundAccount(ledger: MockLedger, publicKey: string, amountStroops: number): void {
  const existing = ledger.accounts.get(publicKey);
  if (existing) {
    existing.balance += amountStroops;
  } else {
    ledger.accounts.set(publicKey, { balance: amountStroops, sequenceNumber: 0 });
  }
}

function getBalance(ledger: MockLedger, publicKey: string): number {
  return ledger.accounts.get(publicKey)?.balance ?? 0;
}

function createChannel(initiator: Keypair, responder: Keypair, fundingAmount: number): PaymentChannel {
  const escrow = generateKeypair(`escrow_${initiator.publicKey.slice(1, 8)}`);
  return {
    id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    escrowPublicKey: escrow.publicKey,
    initiator,
    responder,
    status: 'pending',
    fundingAmount,
    states: [],
  };
}

function fundChannel(channel: PaymentChannel, ledger: MockLedger): boolean {
  const initiatorAccount = ledger.accounts.get(channel.initiator.publicKey);
  if (!initiatorAccount) return false;
  if (initiatorAccount.balance < channel.fundingAmount + BASE_FEE_STROOPS) return false;

  initiatorAccount.balance -= channel.fundingAmount + BASE_FEE_STROOPS;
  fundAccount(ledger, channel.escrowPublicKey, channel.fundingAmount);

  const initialState: ChannelState = {
    sequenceNumber: 1,
    initiatorBalance: channel.fundingAmount,
    responderBalance: 0,
    signatures: [channel.initiator.publicKey, channel.responder.publicKey],
  };
  channel.states.push(initialState);
  channel.status = 'open';
  return true;
}

function createOffChainPayment(
  channel: PaymentChannel,
  amountStroops: number,
  direction: 'initiator_to_responder' | 'responder_to_initiator',
): ChannelState | null {
  if (channel.status !== 'open') return null;
  const latest = channel.states[channel.states.length - 1];

  let newInitiator = latest.initiatorBalance;
  let newResponder = latest.responderBalance;

  if (direction === 'initiator_to_responder') {
    if (newInitiator < amountStroops) return null;
    newInitiator -= amountStroops;
    newResponder += amountStroops;
  } else {
    if (newResponder < amountStroops) return null;
    newResponder -= amountStroops;
    newInitiator += amountStroops;
  }

  const newState: ChannelState = {
    sequenceNumber: latest.sequenceNumber + 1,
    initiatorBalance: newInitiator,
    responderBalance: newResponder,
    signatures: [channel.initiator.publicKey, channel.responder.publicKey],
  };
  channel.states.push(newState);
  return newState;
}

function cooperativeClose(channel: PaymentChannel, ledger: MockLedger): boolean {
  if (channel.status !== 'open') return false;
  const latest = channel.states[channel.states.length - 1];

  const escrowAccount = ledger.accounts.get(channel.escrowPublicKey);
  if (!escrowAccount) return false;

  fundAccount(ledger, channel.initiator.publicKey, latest.initiatorBalance);
  fundAccount(ledger, channel.responder.publicKey, latest.responderBalance);
  escrowAccount.balance = 0;

  channel.status = 'closed';
  return true;
}

function initiateDispute(channel: PaymentChannel, nowSeconds: number): boolean {
  if (channel.status !== 'open') return false;
  channel.status = 'disputed';
  channel.disputeDeadline = nowSeconds + DISPUTE_WINDOW_SECONDS;
  return true;
}

function resolveDispute(
  channel: PaymentChannel,
  ledger: MockLedger,
  submittedStateIndex: number,
  nowSeconds: number,
): { resolved: boolean; reason?: string } {
  if (channel.status !== 'disputed') return { resolved: false, reason: 'not_disputed' };
  if (nowSeconds < channel.disputeDeadline!) return { resolved: false, reason: 'window_open' };

  const state = channel.states[submittedStateIndex];
  if (!state) return { resolved: false, reason: 'invalid_state' };

  // Reject stale state — must be the latest
  const latest = channel.states[channel.states.length - 1];
  if (state.sequenceNumber < latest.sequenceNumber) {
    return { resolved: false, reason: 'stale_state' };
  }

  const escrowAccount = ledger.accounts.get(channel.escrowPublicKey);
  if (!escrowAccount) return { resolved: false, reason: 'no_escrow' };

  fundAccount(ledger, channel.initiator.publicKey, state.initiatorBalance);
  fundAccount(ledger, channel.responder.publicKey, state.responderBalance);
  escrowAccount.balance = 0;
  channel.status = 'closed';
  return { resolved: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeParties() {
  return {
    initiator: generateKeypair('alice'),
    responder: generateKeypair('bob'),
  };
}

function openFundedChannel(ledger: MockLedger, fundingXlm = 10) {
  const { initiator, responder } = makeParties();
  fundAccount(ledger, initiator.publicKey, fundingXlm * XLM + BASE_FEE_STROOPS);
  const channel = createChannel(initiator, responder, fundingXlm * XLM);
  fundChannel(channel, ledger);
  return channel;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Payment channel — creation', () => {
  it('creates a channel with pending status', () => {
    const { initiator, responder } = makeParties();
    const channel = createChannel(initiator, responder, 5 * XLM);
    expect(channel.status).toBe('pending');
    expect(channel.escrowPublicKey).toBeTruthy();
    expect(channel.fundingAmount).toBe(5 * XLM);
  });

  it('assigns unique IDs to each channel', () => {
    const { initiator, responder } = makeParties();
    const a = createChannel(initiator, responder, XLM);
    const b = createChannel(initiator, responder, XLM);
    expect(a.id).not.toBe(b.id);
  });

  it('stores both party keypairs', () => {
    const { initiator, responder } = makeParties();
    const channel = createChannel(initiator, responder, XLM);
    expect(channel.initiator.publicKey).toBe(initiator.publicKey);
    expect(channel.responder.publicKey).toBe(responder.publicKey);
  });
});

describe('Payment channel — funding', () => {
  let ledger: MockLedger;
  beforeEach(() => { ledger = createMockLedger(); });

  it('transitions channel to open after successful funding', () => {
    const channel = openFundedChannel(ledger);
    expect(channel.status).toBe('open');
  });

  it('transfers funding amount to escrow account', () => {
    const channel = openFundedChannel(ledger, 10);
    expect(getBalance(ledger, channel.escrowPublicKey)).toBe(10 * XLM);
  });

  it('deducts funding + fee from initiator balance', () => {
    const { initiator, responder } = makeParties();
    fundAccount(ledger, initiator.publicKey, 20 * XLM);
    const channel = createChannel(initiator, responder, 10 * XLM);
    fundChannel(channel, ledger);
    expect(getBalance(ledger, initiator.publicKey)).toBe(10 * XLM - BASE_FEE_STROOPS);
  });

  it('rejects funding when initiator has insufficient balance', () => {
    const { initiator, responder } = makeParties();
    fundAccount(ledger, initiator.publicKey, 1 * XLM); // less than 10 XLM
    const channel = createChannel(initiator, responder, 10 * XLM);
    expect(fundChannel(channel, ledger)).toBe(false);
    expect(channel.status).toBe('pending');
  });

  it('creates initial channel state with full balance on initiator side', () => {
    const channel = openFundedChannel(ledger, 5);
    const initial = channel.states[0];
    expect(initial.initiatorBalance).toBe(5 * XLM);
    expect(initial.responderBalance).toBe(0);
    expect(initial.sequenceNumber).toBe(1);
  });

  it('initial state is signed by both parties', () => {
    const channel = openFundedChannel(ledger);
    const initial = channel.states[0];
    expect(initial.signatures).toContain(channel.initiator.publicKey);
    expect(initial.signatures).toContain(channel.responder.publicKey);
  });
});

describe('Payment channel — off-chain transactions', () => {
  let ledger: MockLedger;
  let channel: PaymentChannel;
  beforeEach(() => {
    ledger = createMockLedger();
    channel = openFundedChannel(ledger, 10);
  });

  it('creates a new state for each off-chain payment', () => {
    createOffChainPayment(channel, 2 * XLM, 'initiator_to_responder');
    expect(channel.states).toHaveLength(2);
  });

  it('increments sequence number with each payment', () => {
    createOffChainPayment(channel, XLM, 'initiator_to_responder');
    createOffChainPayment(channel, XLM, 'initiator_to_responder');
    expect(channel.states[1].sequenceNumber).toBe(2);
    expect(channel.states[2].sequenceNumber).toBe(3);
  });

  it('correctly updates balances for initiator-to-responder payment', () => {
    const state = createOffChainPayment(channel, 3 * XLM, 'initiator_to_responder')!;
    expect(state.initiatorBalance).toBe(7 * XLM);
    expect(state.responderBalance).toBe(3 * XLM);
  });

  it('correctly updates balances for responder-to-initiator payment', () => {
    createOffChainPayment(channel, 4 * XLM, 'initiator_to_responder');
    const state = createOffChainPayment(channel, 2 * XLM, 'responder_to_initiator')!;
    expect(state.initiatorBalance).toBe(8 * XLM);
    expect(state.responderBalance).toBe(2 * XLM);
  });

  it('rejects payment exceeding available balance', () => {
    const state = createOffChainPayment(channel, 11 * XLM, 'initiator_to_responder');
    expect(state).toBeNull();
    expect(channel.states).toHaveLength(1); // no new state added
  });

  it('rejects payment on a non-open channel', () => {
    channel.status = 'closed';
    expect(createOffChainPayment(channel, XLM, 'initiator_to_responder')).toBeNull();
  });

  it('total balance is conserved across all payments', () => {
    createOffChainPayment(channel, 3 * XLM, 'initiator_to_responder');
    createOffChainPayment(channel, XLM, 'responder_to_initiator');
    createOffChainPayment(channel, 2 * XLM, 'initiator_to_responder');
    const latest = channel.states[channel.states.length - 1];
    expect(latest.initiatorBalance + latest.responderBalance).toBe(10 * XLM);
  });
});

describe('Payment channel — cooperative closure', () => {
  let ledger: MockLedger;
  let channel: PaymentChannel;
  beforeEach(() => {
    ledger = createMockLedger();
    channel = openFundedChannel(ledger, 10);
    createOffChainPayment(channel, 4 * XLM, 'initiator_to_responder');
  });

  it('marks channel as closed after cooperative close', () => {
    cooperativeClose(channel, ledger);
    expect(channel.status).toBe('closed');
  });

  it('distributes final balances to both parties', () => {
    const initiatorBefore = getBalance(ledger, channel.initiator.publicKey);
    const responderBefore = getBalance(ledger, channel.responder.publicKey);
    cooperativeClose(channel, ledger);
    expect(getBalance(ledger, channel.initiator.publicKey)).toBe(initiatorBefore + 6 * XLM);
    expect(getBalance(ledger, channel.responder.publicKey)).toBe(responderBefore + 4 * XLM);
  });

  it('drains escrow account to zero', () => {
    cooperativeClose(channel, ledger);
    expect(getBalance(ledger, channel.escrowPublicKey)).toBe(0);
  });

  it('rejects close on a non-open channel', () => {
    channel.status = 'closed';
    expect(cooperativeClose(channel, ledger)).toBe(false);
  });
});

describe('Payment channel — dispute resolution', () => {
  let ledger: MockLedger;
  let channel: PaymentChannel;
  const NOW = 1_700_000_000;

  beforeEach(() => {
    ledger = createMockLedger();
    channel = openFundedChannel(ledger, 10);
    createOffChainPayment(channel, 3 * XLM, 'initiator_to_responder');
    createOffChainPayment(channel, XLM, 'initiator_to_responder');
  });

  it('transitions channel to disputed status', () => {
    initiateDispute(channel, NOW);
    expect(channel.status).toBe('disputed');
  });

  it('sets dispute deadline 24 h in the future', () => {
    initiateDispute(channel, NOW);
    expect(channel.disputeDeadline).toBe(NOW + DISPUTE_WINDOW_SECONDS);
  });

  it('rejects dispute initiation on non-open channel', () => {
    channel.status = 'closed';
    expect(initiateDispute(channel, NOW)).toBe(false);
  });

  it('resolves dispute after window expires with latest state', () => {
    initiateDispute(channel, NOW);
    const afterWindow = NOW + DISPUTE_WINDOW_SECONDS + 1;
    const result = resolveDispute(channel, ledger, channel.states.length - 1, afterWindow);
    expect(result.resolved).toBe(true);
    expect(channel.status).toBe('closed');
  });

  it('rejects resolution before dispute window expires', () => {
    initiateDispute(channel, NOW);
    const result = resolveDispute(channel, ledger, channel.states.length - 1, NOW + 100);
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('window_open');
  });

  it('rejects stale state submission during dispute', () => {
    initiateDispute(channel, NOW);
    const afterWindow = NOW + DISPUTE_WINDOW_SECONDS + 1;
    const result = resolveDispute(channel, ledger, 0, afterWindow); // state index 0 is stale
    expect(result.resolved).toBe(false);
    expect(result.reason).toBe('stale_state');
  });

  it('distributes correct balances after dispute resolution', () => {
    initiateDispute(channel, NOW);
    const afterWindow = NOW + DISPUTE_WINDOW_SECONDS + 1;
    resolveDispute(channel, ledger, channel.states.length - 1, afterWindow);
    const latest = channel.states[channel.states.length - 1];
    expect(getBalance(ledger, channel.initiator.publicKey)).toBe(latest.initiatorBalance);
    expect(getBalance(ledger, channel.responder.publicKey)).toBe(latest.responderBalance);
  });

  it('drains escrow after dispute resolution', () => {
    initiateDispute(channel, NOW);
    resolveDispute(channel, ledger, channel.states.length - 1, NOW + DISPUTE_WINDOW_SECONDS + 1);
    expect(getBalance(ledger, channel.escrowPublicKey)).toBe(0);
  });
});
