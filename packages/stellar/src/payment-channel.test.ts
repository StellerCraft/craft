import { describe, it, expect } from 'vitest';
import { Keypair } from 'stellar-sdk';
import {
  cooperativeClose,
  unilateralClose,
  disputeClose,
  PaymentChannelError,
} from './payment-channel';
import type { ChannelState } from './payment-channel';

const partyAId = Keypair.random().publicKey();
const partyBId = Keypair.random().publicKey();

const baseState: ChannelState = {
  channelId: 'chan-001',
  partyA: { accountId: partyAId, balance: '60' },
  partyB: { accountId: partyBId, balance: '40' },
  sequenceNumber: 5,
  closeAfterTimestamp: 1_000_000,
};

describe('PaymentChannel', () => {
  describe('cooperativeClose', () => {
    it('returns correct final balances when both parties sign', () => {
      const result = cooperativeClose(baseState, partyAId, partyBId);
      expect(result.type).toBe('cooperative');
      expect(result.finalBalanceA).toBe('60');
      expect(result.finalBalanceB).toBe('40');
      expect(result.sequenceNumber).toBe(5);
    });

    it('throws when signerAId does not match partyA', () => {
      expect(() => cooperativeClose(baseState, partyBId, partyBId)).toThrow(
        PaymentChannelError
      );
    });

    it('throws when signerBId does not match partyB', () => {
      expect(() => cooperativeClose(baseState, partyAId, partyAId)).toThrow(
        PaymentChannelError
      );
    });
  });

  describe('unilateralClose', () => {
    const afterTimeout = baseState.closeAfterTimestamp + 1;
    const beforeTimeout = baseState.closeAfterTimestamp - 1;

    it('allows partyA to close after timeout', () => {
      const result = unilateralClose(baseState, partyAId, afterTimeout);
      expect(result.type).toBe('unilateral');
      expect(result.finalBalanceA).toBe('60');
      expect(result.finalBalanceB).toBe('40');
    });

    it('allows partyB to close after timeout', () => {
      const result = unilateralClose(baseState, partyBId, afterTimeout);
      expect(result.type).toBe('unilateral');
    });

    it('throws before timeout elapses', () => {
      expect(() => unilateralClose(baseState, partyAId, beforeTimeout)).toThrow(
        PaymentChannelError
      );
    });

    it('throws for a non-participant', () => {
      const outsider = Keypair.random().publicKey();
      expect(() => unilateralClose(baseState, outsider, afterTimeout)).toThrow(
        PaymentChannelError
      );
    });
  });

  describe('disputeClose', () => {
    const newerState: ChannelState = {
      ...baseState,
      partyA: { accountId: partyAId, balance: '70' },
      partyB: { accountId: partyBId, balance: '30' },
      sequenceNumber: 8,
    };

    it('accepts newer state and returns its balances', () => {
      const result = disputeClose(baseState, newerState);
      expect(result.type).toBe('dispute');
      expect(result.finalBalanceA).toBe('70');
      expect(result.finalBalanceB).toBe('30');
      expect(result.sequenceNumber).toBe(8);
    });

    it('rejects when newer state has equal sequenceNumber', () => {
      expect(() =>
        disputeClose(baseState, { ...newerState, sequenceNumber: 5 })
      ).toThrow(PaymentChannelError);
    });

    it('rejects when newer state has lower sequenceNumber', () => {
      expect(() =>
        disputeClose(baseState, { ...newerState, sequenceNumber: 3 })
      ).toThrow(PaymentChannelError);
    });

    it('rejects states from different channels', () => {
      const differentChannel: ChannelState = { ...newerState, channelId: 'chan-999' };
      expect(() => disputeClose(baseState, differentChannel)).toThrow(PaymentChannelError);
    });
  });
});
