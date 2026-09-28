/**
 * Circuit breaker — re-exported from the shared @craft/stellar implementation
 * (packages/stellar/src/circuit-breaker.ts), mirroring the backend, so all
 * apps use a single state machine.
 */
export { CircuitBreaker, CircuitOpenError } from '@craft/stellar';
export type { CircuitState, CircuitBreakerConfig } from '@craft/stellar';
