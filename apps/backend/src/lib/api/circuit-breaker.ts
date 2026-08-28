/**
 * Circuit Breaker Pattern for External Service Calls
 *
 * Re-exports the unified implementation from @craft/stellar package.
 * This ensures all circuit breaker instances across the application
 * share the same behavior and bug fixes.
 *
 * @see packages/stellar/src/circuit-breaker.ts
 */

export { CircuitBreaker, CircuitOpenError, CircuitState, CircuitBreakerConfig } from '@craft/stellar';
