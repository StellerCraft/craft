/**
 * Integration tests for #1151: a retried checkout that lands in a different
 * one-second window must not produce more than one metered-usage record when a
 * stable (payment) idempotency key is threaded through to recordUsage.
 *
 * Run: vitest run src/services/metered-billing.integration.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MeteringService } from './metered-billing.service';

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from: mockFrom }),
}));

// Mocked Supabase query surface.
const mockFrom = vi.fn();
const insertSpy = vi.fn();

function selectChain(singleResult: any) {
  const builder: any = {
    eq: () => builder,
    single: () => Promise.resolve(singleResult),
  };
  return { select: () => builder };
}

function insertChain() {
  return {
    insert: (_data: any) => {
      insertSpy(_data);
      return {
        select: () => ({
          single: () =>
            Promise.resolve({
              data: { id: 'rec-1', ..._data },
              error: null,
            }),
        }),
      };
    },
  };
}

function updateChain() {
  return {
    update: (_data: any) => ({
      eq: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: { id: 'rec-1', ..._data },
              error: null,
            }),
        }),
      }),
    }),
  };
}

const NOT_FOUND = { data: null, error: { code: 'PGRST116' } };
const EXISTING = { data: { id: 'rec-1', quantity: 1 }, error: null };

describe('MeteringService.recordUsage idempotency (#1151)', () => {
  let service: MeteringService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    insertSpy.mockClear();
    mockFrom.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records only ONE usage row for a retried checkout across a second boundary when a stable key is threaded', async () => {
    service = new MeteringService();
    const STABLE_KEY = 'checkout_abc_123';

    // First attempt (second 0).
    mockFrom
      .mockReturnValueOnce(selectChain(NOT_FOUND))
      .mockReturnValueOnce(insertChain());
    const first = await service.recordUsage('user-1', 'checkout_session', 1, {}, STABLE_KEY);

    // Retry lands in a different one-second window.
    vi.advanceTimersByTime(1500);
    mockFrom
      .mockReturnValueOnce(selectChain(EXISTING)) // same key -> existing record
      .mockReturnValueOnce(updateChain());
    const second = await service.recordUsage('user-1', 'checkout_session', 1, {}, STABLE_KEY);

    // Exactly one row was ever inserted...
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const inserted = insertSpy.mock.calls[0][0] as any;
    expect(inserted.idempotency_key).toBe(STABLE_KEY);
    // ...and the replay did NOT add a second unit of quantity (no double billing).
    expect(first.quantity).toBe(1);
    expect(second.quantity).toBe(1);
  });

  it('still allows the legacy one-second key to double-count when NO stable key is supplied', async () => {
    service = new MeteringService();

    // First attempt (second 0).
    mockFrom
      .mockReturnValueOnce(selectChain(NOT_FOUND))
      .mockReturnValueOnce(insertChain());
    await service.recordUsage('user-1', 'checkout_session', 1);

    // Retry in a different second, no stable key -> distinct legacy key -> new row.
    vi.advanceTimersByTime(1500);
    mockFrom
      .mockReturnValueOnce(selectChain(NOT_FOUND))
      .mockReturnValueOnce(insertChain());
    await service.recordUsage('user-1', 'checkout_session', 1);

    expect(insertSpy).toHaveBeenCalledTimes(2);
  });
});
