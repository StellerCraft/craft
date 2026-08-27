/**
 * Tests for rotateProfileEncryptedColumns batching behavior (#1063)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encrypt } from './field-encryption';
import { rotateProfileEncryptedColumns } from './key-rotation';

const VALID_KEY = 'a'.repeat(64);

function makeOldBlob(plaintext: string): string {
    const realBlob = encrypt(plaintext);
    return 'v0' + realBlob.slice(2);
}

describe('key-rotation: rotateProfileEncryptedColumns', () => {
    beforeEach(() => {
        process.env.FIELD_ENCRYPTION_KEY = VALID_KEY;
        process.env.FIELD_ENCRYPTION_KEY_0 = VALID_KEY;
    });

    afterEach(() => {
        delete process.env.FIELD_ENCRYPTION_KEY;
        delete process.env.FIELD_ENCRYPTION_KEY_0;
    });

    it('rotates rows using a single batched upsert instead of one round trip per row', async () => {
        const upsertPayloads: unknown[] = [];

        const rows = [
            { 
                id: 'row-1', 
                stripe_customer_id_encrypted: makeOldBlob('cus_1'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_1'),
            },
            { 
                id: 'row-2', 
                stripe_customer_id_encrypted: makeOldBlob('cus_2'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_2'),
            },
            { 
                id: 'row-3', 
                stripe_customer_id_encrypted: makeOldBlob('cus_3'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_3'),
            },
        ];

        const supabase = {
            from: (table: string) => ({
                select: (cols: string) => ({
                    not: (col: string) => Promise.resolve({ data: rows, error: null }),
                }),
                upsert: (payload: unknown) => {
                    upsertPayloads.push(payload);
                    return Promise.resolve({ error: null });
                },
            }),
        } as any;

        const summary = await rotateProfileEncryptedColumns(supabase);

        expect(summary.stripe_customer_id_encrypted.total).toBe(3);
        expect(summary.stripe_customer_id_encrypted.rotated).toBe(3);
        expect(summary.stripe_subscription_id_encrypted.total).toBe(3);
        expect(summary.stripe_subscription_id_encrypted.rotated).toBe(3);

        expect(upsertPayloads).toHaveLength(2);
        expect((upsertPayloads[0] as any[]).length).toBe(3);
        expect((upsertPayloads[1] as any[]).length).toBe(3);
    });

    it('skips rows already at the current key version and only upserts changed rows', async () => {
        const upsertPayloads: unknown[] = [];

        const currentBlob = encrypt('cus_current');
        const rows = [
            { 
                id: 'row-keep', 
                stripe_customer_id_encrypted: currentBlob,
                stripe_subscription_id_encrypted: makeOldBlob('sub_old'),
            },
            { 
                id: 'row-rotate', 
                stripe_customer_id_encrypted: makeOldBlob('cus_old'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_old2'),
            },
        ];

        const supabase = {
            from: (table: string) => ({
                select: (cols: string) => ({
                    not: (col: string) => Promise.resolve({ data: rows, error: null }),
                }),
                upsert: (payload: unknown) => {
                    upsertPayloads.push(payload);
                    return Promise.resolve({ error: null });
                },
            }),
        } as any;

        const summary = await rotateProfileEncryptedColumns(supabase);

        expect(summary.stripe_customer_id_encrypted.total).toBe(2);
        expect(summary.stripe_customer_id_encrypted.rotated).toBe(1);
        expect(summary.stripe_subscription_id_encrypted.total).toBe(2);
        expect(summary.stripe_subscription_id_encrypted.rotated).toBe(2);

        expect(upsertPayloads).toHaveLength(2);
        const customerPayload = upsertPayloads[0] as any[];
        expect(customerPayload).toHaveLength(1);
        expect(customerPayload[0].id).toBe('row-rotate');
    });

    it('reports an error when the batched upsert fails', async () => {
        const rows = [
            { 
                id: 'row-1', 
                stripe_customer_id_encrypted: makeOldBlob('cus_1'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_1'),
            },
        ];

        let callCount = 0;
        const supabase = {
            from: (table: string) => ({
                select: (cols: string) => ({
                    not: (col: string) => Promise.resolve({ data: rows, error: null }),
                }),
                upsert: (payload: unknown) => {
                    callCount++;
                    if (callCount === 1) {
                        return Promise.resolve({ error: null });
                    }
                    return Promise.resolve({ error: { message: 'upsert failed' } });
                },
            }),
        } as any;

        await expect(
            rotateProfileEncryptedColumns(supabase),
        ).rejects.toThrow('Failed to update rows for stripe_subscription_id_encrypted: upsert failed');
    });
});
