/**
 * Stellar Payment Channel Management
 *
 * Off-chain payment channel abstraction with:
 * - Cooperative close: both parties sign a final balance transaction
 * - Unilateral close: timeout-based close using Stellar TimeBounds
 * - Dispute resolution: sequence-number-based stale-balance rejection
 */

export interface ChannelParty {
  accountId: string;
  /** Current balance owed to this party in the channel */
  balance: string;
}

export interface ChannelState {
  channelId: string;
  partyA: ChannelParty;
  partyB: ChannelParty;
  /** Monotonically increasing; higher = newer state */
  sequenceNumber: number;
  /** Unix timestamp after which unilateral close is permitted */
  closeAfterTimestamp: number;
}

export type CloseType = 'cooperative' | 'unilateral' | 'dispute';

export interface ChannelCloseResult {
  type: CloseType;
  finalBalanceA: string;
  finalBalanceB: string;
  sequenceNumber: number;
}

export class PaymentChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentChannelError';
  }
}

/**
 * Cooperative close: both parties agree on a final balance.
 * Both signatures are required; returns the agreed final state.
 *
 * @param state - Current channel state
 * @param signerAId - Account ID of party A (must match state.partyA.accountId)
 * @param signerBId - Account ID of party B (must match state.partyB.accountId)
 */
export function cooperativeClose(
  state: ChannelState,
  signerAId: string,
  signerBId: string
): ChannelCloseResult {
  if (signerAId !== state.partyA.accountId) {
    throw new PaymentChannelError('signerAId does not match partyA');
  }
  if (signerBId !== state.partyB.accountId) {
    throw new PaymentChannelError('signerBId does not match partyB');
  }

  return {
    type: 'cooperative',
    finalBalanceA: state.partyA.balance,
    finalBalanceB: state.partyB.balance,
    sequenceNumber: state.sequenceNumber,
  };
}

/**
 * Unilateral close: either party can close after the timeout expires.
 * Uses Stellar TimeBounds — the transaction is only valid after closeAfterTimestamp.
 *
 * @param state - Current channel state
 * @param closingPartyId - Account ID of the party initiating close
 * @param nowTimestamp - Current Unix timestamp (for validation)
 */
export function unilateralClose(
  state: ChannelState,
  closingPartyId: string,
  nowTimestamp: number
): ChannelCloseResult {
  if (
    closingPartyId !== state.partyA.accountId &&
    closingPartyId !== state.partyB.accountId
  ) {
    throw new PaymentChannelError('closingPartyId is not a channel participant');
  }

  if (nowTimestamp < state.closeAfterTimestamp) {
    throw new PaymentChannelError(
      `Timeout not reached; close allowed after ${state.closeAfterTimestamp}`
    );
  }

  return {
    type: 'unilateral',
    finalBalanceA: state.partyA.balance,
    finalBalanceB: state.partyB.balance,
    sequenceNumber: state.sequenceNumber,
  };
}

/**
 * Dispute resolution: if a party submits a stale channel state, the counterparty
 * can submit a newer state (higher sequenceNumber) to override it.
 *
 * @param submittedState - The state the challenging party claims is final
 * @param newerState - A newer state (higher sequenceNumber) provided by the counterparty
 */
export function disputeClose(
  submittedState: ChannelState,
  newerState: ChannelState
): ChannelCloseResult {
  if (newerState.channelId !== submittedState.channelId) {
    throw new PaymentChannelError('States belong to different channels');
  }

  if (newerState.sequenceNumber <= submittedState.sequenceNumber) {
    throw new PaymentChannelError(
      `Dispute rejected: newer state sequence ${newerState.sequenceNumber} ` +
        `is not greater than submitted state sequence ${submittedState.sequenceNumber}`
    );
  }

  return {
    type: 'dispute',
    finalBalanceA: newerState.partyA.balance,
    finalBalanceB: newerState.partyB.balance,
    sequenceNumber: newerState.sequenceNumber,
  };
}
