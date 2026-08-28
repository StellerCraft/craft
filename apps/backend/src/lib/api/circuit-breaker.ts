/**
 * Circuit breaker pattern for external service calls.
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
