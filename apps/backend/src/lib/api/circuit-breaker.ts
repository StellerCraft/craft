/**
 * Circuit Breaker Pattern for External Service Calls
 *
 * Unified implementation also available in packages/stellar/src/circuit-breaker.ts
 * Both implementations share the same behavior and bug fixes.
 * Maintains backward compatibility with all existing tests.
 *
 * Re-exports the shared CircuitBreaker from @craft/stellar for use in the backend.
 * See packages/stellar/src/circuit-breaker.ts for the implementation.
 */

export {
    CircuitState,
    CircuitBreakerConfig,
    CircuitOpenError,
    CircuitBreaker,
} from '@craft/stellar';
