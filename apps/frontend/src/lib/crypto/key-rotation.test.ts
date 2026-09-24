import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encrypt } from './field-encryption';
import { rotateProfileEncryptedColumns } from './key-rotation';

const VALID_KEY = 'a'.repeat(64);

function makeOldBlob(plaintext: string): string {
  const realBlob = encrypt(plaintext);
  return 'v0' + realBlob.slice(2);
}

describe('rotateProfileEncryptedColumns', () => {
  beforeEach(() => {
    process.env.FIELD_ENCRYPTION_KEY = VALID_KEY;
    process.env.FIELD_ENCRYPTION_KEY_0 = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY_0;
  });

  it('uses upsert for batched updates instead of per-row update calls', async () => {
    const upsertCalls: any[] = [];

    const mockRowsCustomer = [
      { id: '1', stripe_customer_id_encrypted: makeOldBlob('cus_1') },
      { id: '2', stripe_customer_id_encrypted: makeOldBlob('cus_2') },
    ];

    const mockRowsSubscription = [
      { id: '1', stripe_subscription_id_encrypted: makeOldBlob('sub_1') },
      { id: '2', stripe_subscription_id_encrypted: makeOldBlob('sub_2') },
    ];

    const mockSupabase = {
      from: (table: string) => ({
        select: (cols: string) => ({
          not: (col: string) => {
            const data = col === 'stripe_customer_id_encrypted' ? mockRowsCustomer : mockRowsSubscription;
            return Promise.resolve({ data, error: null });
          },
        }),
        upsert: (payload: unknown) => {
          upsertCalls.push(payload);
          return Promise.resolve({ error: null });
        },
      }),
    } as any;

    await rotateProfileEncryptedColumns(mockSupabase);

    expect(upsertCalls.length).toBeGreaterThan(0);
    expect(upsertCalls[0]).toBeInstanceOf(Array);
  });

  it('batches multiple rows into a single call per column', async () => {
    const upsertCalls: any[] = [];

    const mockRowsCustomer = [
      { id: '1', stripe_customer_id_encrypted: makeOldBlob('cus_1') },
      { id: '2', stripe_customer_id_encrypted: makeOldBlob('cus_2') },
      { id: '3', stripe_customer_id_encrypted: makeOldBlob('cus_3') },
    ];

    const mockRowsSubscription = [
      { id: '1', stripe_subscription_id_encrypted: makeOldBlob('sub_1') },
      { id: '2', stripe_subscription_id_encrypted: makeOldBlob('sub_2') },
      { id: '3', stripe_subscription_id_encrypted: makeOldBlob('sub_3') },
    ];

    const mockSupabase = {
      from: (table: string) => ({
        select: (cols: string) => ({
          not: (col: string) => {
            const data = col === 'stripe_customer_id_encrypted' ? mockRowsCustomer : mockRowsSubscription;
            return Promise.resolve({ data, error: null });
          },
        }),
        upsert: (payload: unknown) => {
          upsertCalls.push(payload);
          return Promise.resolve({ error: null });
        },
      }),
    } as any;

    const summary = await rotateProfileEncryptedColumns(mockSupabase);

    expect(upsertCalls.length).toBe(2);
    expect((upsertCalls[0] as any[]).length).toBe(3);
    expect((upsertCalls[1] as any[]).length).toBe(3);
    expect(summary.stripe_subscription_id_encrypted.total).toBe(3);
    expect(summary.stripe_subscription_id_encrypted.rotated).toBe(3);
  });
});
