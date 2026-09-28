import { describe, it, expect, vi } from 'vitest';
import * as shared from '@craft/stellar';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

// The frontend re-exports the shared @craft/stellar implementation; the state
// machine itself is tested in packages/stellar. These tests pin the public API
// the frontend depends on.
describe('frontend circuit-breaker (shared @craft/stellar re-export)', () => {
    it('re-exports the shared implementation', () => {
        expect(CircuitBreaker).toBe(shared.CircuitBreaker);
        expect(CircuitOpenError).toBe(shared.CircuitOpenError);
    });

    it('supports the constructor options, call(), currentState and reset()', async () => {
        let t = 0;
        const onStateChange = vi.fn();
        const breaker = new CircuitBreaker({
            name: 'compat',
            failureThreshold: 2,
            resetTimeoutMs: 1000,
            now: () => t,
            onStateChange,
        });

        expect(breaker.currentState).toBe('CLOSED');
        await expect(breaker.call(() => Promise.resolve('ok'))).resolves.toBe('ok');

        for (let i = 0; i < 2; i++) await breaker.call(() => Promise.reject(new Error('x'))).catch(() => {});
        expect(breaker.currentState).toBe('OPEN');
        await expect(breaker.call(() => Promise.resolve('ok'))).rejects.toBeInstanceOf(CircuitOpenError);

        t = 1000;
        await expect(breaker.call(() => Promise.resolve('ok'))).resolves.toBe('ok');
        expect(breaker.currentState).toBe('CLOSED');
        expect(onStateChange.mock.calls.map((c) => `${c[1]}->${c[2]}`)).toEqual([
            'CLOSED->OPEN',
            'OPEN->HALF_OPEN',
            'HALF_OPEN->CLOSED',
        ]);

        breaker.reset();
        expect(breaker.currentState).toBe('CLOSED');
    });
});
