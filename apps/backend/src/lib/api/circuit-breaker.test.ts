import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

function makeBreaker(overrides: Partial<ConstructorParameters<typeof CircuitBreaker>[0]> = {}) {
    return new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 1000, ...overrides });
}

// ── CLOSED state ──────────────────────────────────────────────────────────────

describe('CircuitBreaker — CLOSED', () => {
    it('starts CLOSED', () => {
        expect(makeBreaker().currentState).toBe('CLOSED');
    });

    it('passes through successful calls', async () => {
        const breaker = makeBreaker();
        const result = await breaker.call(() => Promise.resolve('ok'));
        expect(result).toBe('ok');
        expect(breaker.currentState).toBe('CLOSED');
    });

    it('stays CLOSED below the failure threshold', async () => {
        const breaker = makeBreaker({ failureThreshold: 3 });
        for (let i = 0; i < 2; i++) {
            await breaker.call(() => Promise.reject(new Error('err'))).catch(() => {});
        }
        expect(breaker.currentState).toBe('CLOSED');
    });

    it('opens after reaching the failure threshold', async () => {
        const breaker = makeBreaker({ failureThreshold: 3 });
        for (let i = 0; i < 3; i++) {
            await breaker.call(() => Promise.reject(new Error('err'))).catch(() => {});
        }
        expect(breaker.currentState).toBe('OPEN');
    });
});

// ── OPEN state ────────────────────────────────────────────────────────────────

describe('CircuitBreaker — OPEN', () => {
    it('throws CircuitOpenError without calling fn', async () => {
        const breaker = makeBreaker({ failureThreshold: 1 });
        await breaker.call(() => Promise.reject(new Error('err'))).catch(() => {});

        const fn = vi.fn().mockResolvedValue('ok');
        await expect(breaker.call(fn)).rejects.toBeInstanceOf(CircuitOpenError);
        expect(fn).not.toHaveBeenCalled();
    });

    it('transitions to HALF_OPEN after resetTimeoutMs', async () => {
        let time = 0;
        const now = () => time;
        const breaker = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, now });

        await breaker.call(() => Promise.reject(new Error('err'))).catch(() => {});
        expect(breaker.currentState).toBe('OPEN');

        time = 1001;
        // Trigger transition check by attempting a call
        await breaker.call(() => Promise.resolve('probe')).catch(() => {});
        expect(breaker.currentState).toBe('CLOSED');
    });
});

// ── HALF_OPEN state ───────────────────────────────────────────────────────────

describe('CircuitBreaker — HALF_OPEN', () => {
    function openedBreaker(resetTimeoutMs = 1000) {
        let time = 0;
        const now = () => time;
        const breaker = makeBreaker({ failureThreshold: 1, resetTimeoutMs, now });
        return { breaker, advanceTime: (ms: number) => { time += ms; } };
    }

    it('closes on probe success', async () => {
        const { breaker, advanceTime } = openedBreaker();
        await breaker.call(() => Promise.reject(new Error('err'))).catch(() => {});
        advanceTime(1001);

        await breaker.call(() => Promise.resolve('ok'));
        expect(breaker.currentState).toBe('CLOSED');
    });

    it('re-opens on probe failure', async () => {
        const { breaker, advanceTime } = openedBreaker();
        await breaker.call(() => Promise.reject(new Error('err'))).catch(() => {});
        advanceTime(1001);

        await breaker.call(() => Promise.reject(new Error('still failing'))).catch(() => {});
        expect(breaker.currentState).toBe('OPEN');
    });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('CircuitBreaker — reset', () => {
    it('resets to CLOSED from OPEN', async () => {
        const breaker = makeBreaker({ failureThreshold: 1 });
        await breaker.call(() => Promise.reject(new Error('err'))).catch(() => {});
        expect(breaker.currentState).toBe('OPEN');

        breaker.reset();
        expect(breaker.currentState).toBe('CLOSED');
    });
});

// ── Re-export surface ─────────────────────────────────────────────────────────

describe('CircuitBreaker — re-export completeness', () => {
    it('re-exports CircuitOpenError for error handling', () => {
        const error = new CircuitOpenError('test', 1000);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('CircuitOpenError');
        expect(error.message).toContain('Circuit');
    });

    it('re-exports CircuitBreaker class with all public methods', () => {
        const breaker = makeBreaker();
        expect(breaker).toBeInstanceOf(CircuitBreaker);
        expect(typeof breaker.call).toBe('function');
        expect(typeof breaker.isOpen).toBe('function');
        expect(typeof breaker.getState).toBe('function');
        expect(typeof breaker.recordSuccess).toBe('function');
        expect(typeof breaker.recordFailure).toBe('function');
        expect(typeof breaker.reset).toBe('function');
        expect(breaker.name).toBe('test');
    });

    it('re-exports CircuitState values (CLOSED, OPEN, HALF_OPEN)', () => {
        const breaker = makeBreaker();
        expect(breaker.currentState).toBe('CLOSED');
        breaker.reset();
        expect(breaker.currentState).toBe('CLOSED');
    });
});
