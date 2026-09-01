/**
 * Unified Circuit Breaker Pattern for External Service Calls
 *
 * Prevents cascading failures by stopping calls to a service that is
 * consistently failing, giving it time to recover.
 *
 * States:
 *   CLOSED    — normal operation; failures are counted
 *   OPEN      — calls are rejected immediately (fast-fail)
 *   HALF_OPEN — one probe call is allowed through to test recovery
 *
 * Transitions:
 *   CLOSED  → OPEN      when failureCount >= failureThreshold
 *   OPEN    → HALF_OPEN after resetTimeoutMs has elapsed
 *   HALF_OPEN → CLOSED  on probe success
 *   HALF_OPEN → OPEN    on probe failure (resets the timeout)
 *
 * Supports two usage patterns:
 *   1. Functional wrapper: await breaker.call(() => someAsyncFn())
 *   2. Manual state checks: isOpen(), recordSuccess(), recordFailure()
 *
 * @example
 * // Functional API (recommended)
 * const breaker = new CircuitBreaker({ name: 'github' });
 * const result = await breaker.call(() => githubService.createRepo(...));
 *
 * @example
 * // Manual state API
 * const breaker = new CircuitBreaker({ name: 'horizon' });
 * if (breaker.isOpen()) throw new Error('Service unavailable');
 * try {
 *   await horizonService.request();
 *   breaker.recordSuccess();
 * } catch (err) {
 *   breaker.recordFailure();
 *   throw err;
 * }
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Human-readable name used in error messages. */
  name: string;
  /** Number of consecutive failures before opening. Default: 5 */
  failureThreshold?: number;
  /** How long (ms) to wait in OPEN before allowing a probe. Default: 30_000 */
  resetTimeoutMs?: number;
  /** Injected clock — override in tests. Default: Date.now */
  now?: () => number;
  /** Called whenever the circuit transitions between states. */
  onStateChange?: (name: string, from: CircuitState, to: CircuitState, metadata?: Record<string, unknown>) => void;
}

/** Thrown when a call is rejected because the circuit is OPEN. */
export class CircuitOpenError extends Error {
  constructor(name: string, retryAfterMs: number) {
    super(`Circuit "${name}" is OPEN — retry after ${retryAfterMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly now: () => number;
  private readonly onStateChange?: CircuitBreakerConfig['onStateChange'];
  readonly name: string;

  constructor(config: CircuitBreakerConfig) {
    this.name = config.name;
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 30_000;
    this.now = config.now ?? Date.now;
    this.onStateChange = config.onStateChange;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Execute `fn` through the circuit breaker (functional API).
   * Throws `CircuitOpenError` immediately when the circuit is OPEN.
   *
   * @param fn - Async function to execute
   * @returns Result of fn
   * @throws CircuitOpenError when the circuit is OPEN
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.transitionIfDue();

    if (this.state === 'OPEN') {
      const retryAfterMs = this.openedAt! + this.resetTimeoutMs - this.now();
      throw new CircuitOpenError(this.name, Math.max(0, retryAfterMs));
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /**
   * Check if the circuit is currently OPEN (manual state API).
   *
   * @returns true if the circuit is OPEN
   */
  isOpen(): boolean {
    this.transitionIfDue();
    return this.state === 'OPEN';
  }

  /**
   * Get the current state (manual state API).
   *
   * @returns Current circuit state
   */
  getState(): CircuitState {
    this.transitionIfDue();
    return this.state;
  }

  /**
   * Record a successful call (manual state API).
   * Resets failure count and transitions to CLOSED.
   */
  recordSuccess(): void {
    this.onSuccess();
  }

  /**
   * Record a failed call (manual state API).
   * Increments failure count and may transition to OPEN.
   */
  recordFailure(): void {
    this.onFailure();
  }

  /** Manually reset to CLOSED (e.g. after a config change). */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.openedAt = null;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private transitionIfDue(): void {
    if (this.state === 'OPEN' && this.openedAt !== null) {
      if (this.now() - this.openedAt >= this.resetTimeoutMs) {
        this.transition('HALF_OPEN', { waitedMs: this.now() - this.openedAt });
      }
    }
  }

  private onSuccess(): void {
    const prev = this.state;
    this.failureCount = 0;
    this.openedAt = null;
    this.state = 'CLOSED';
    if (prev !== 'CLOSED') this.onStateChange?.(this.name, prev, 'CLOSED');
  }

  private onFailure(): void {
    this.failureCount += 1;

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      const prev = this.state;
      this.state = 'OPEN';
      this.openedAt = this.now();
      this.failureCount = 0;
      this.onStateChange?.(this.name, prev, 'OPEN', { resetTimeoutMs: this.resetTimeoutMs });
    }
  }

  private transition(to: CircuitState, metadata?: Record<string, unknown>): void {
    const from = this.state;
    this.state = to;
    this.onStateChange?.(this.name, from, to, metadata);
  }
}
