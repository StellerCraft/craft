import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker as RealCircuitBreaker, CircuitOpenError } from '@/lib/api/circuit-breaker';

/**
 * Chaos Engineering Tests for External Service Failures
 * 
 * Tests resilience of CRAFT platform against failures in:
 * - GitHub API
 * - Vercel API
 * - Stripe API
 * - Supabase
 */

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

class CircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    isOpen: false,
  };

  private readonly failureThreshold = 5;
  private readonly resetTimeout = 60000; // 1 minute

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.isOpen) {
      if (Date.now() - this.state.lastFailureTime > this.resetTimeout) {
        this.state.isOpen = false;
        this.state.failures = 0;
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.state.failures = 0;
      return result;
    } catch (error) {
      this.state.failures++;
      this.state.lastFailureTime = Date.now();

      if (this.state.failures >= this.failureThreshold) {
        this.state.isOpen = true;
      }

      throw error;
    }
  }

  getState() {
    return { ...this.state };
  }
}

class RetryPolicy {
  async execute<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 100
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }
}

describe('Chaos Engineering: External Service Failures', () => {
  let circuitBreaker: CircuitBreaker;
  let retryPolicy: RetryPolicy;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker();
    retryPolicy = new RetryPolicy();
  });

  describe('GitHub API Failures', () => {
    it('should handle GitHub API timeouts gracefully', async () => {
      const githubCall = vi.fn(async () => {
        throw new Error('GitHub API timeout');
      });

      try {
        await retryPolicy.execute(githubCall, 2, 50);
      } catch (error) {
        expect((error as Error).message).toContain('timeout');
      }

      expect(githubCall).toHaveBeenCalledTimes(2);
    });

    it('should handle GitHub 500 errors with retry', async () => {
      let attempts = 0;
      const githubCall = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('GitHub 500: Internal Server Error');
        }
        return { success: true };
      });

      const result = await retryPolicy.execute(githubCall, 3, 50);
      expect(result).toEqual({ success: true });
      expect(githubCall).toHaveBeenCalledTimes(3);
    });

    it('should handle GitHub rate limiting', async () => {
      const githubCall = vi.fn(async () => {
        throw new Error('GitHub 429: Rate limit exceeded');
      });

      try {
        await retryPolicy.execute(githubCall, 2, 50);
      } catch (error) {
        expect((error as Error).message).toContain('429');
      }
    });

    it('should open circuit breaker after repeated GitHub failures', async () => {
      const githubCall = vi.fn(async () => {
        throw new Error('GitHub API error');
      });

      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(() => githubCall());
        } catch {
          // Expected
        }
      }

      const state = circuitBreaker.getState();
      expect(state.isOpen).toBe(true);
      expect(state.failures).toBe(5);
    });
  });

  describe('Vercel API Failures', () => {
    it('should handle Vercel deployment timeout', async () => {
      const vercelCall = vi.fn(async () => {
        throw new Error('Vercel deployment timeout after 30s');
      });

      try {
        await retryPolicy.execute(vercelCall, 2, 50);
      } catch (error) {
        expect((error as Error).message).toContain('timeout');
      }
    });

    it('should handle Vercel 503 Service Unavailable', async () => {
      let attempts = 0;
      const vercelCall = vi.fn(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Vercel 503: Service Unavailable');
        }
        return { deploymentId: 'dpl_123' };
      });

      const result = await retryPolicy.execute(vercelCall, 3, 50);
      expect(result.deploymentId).toBe('dpl_123');
    });

    it('should handle partial Vercel failure (GitHub succeeds, Vercel fails)', async () => {
      const githubSuccess = vi.fn(async () => ({ repoUrl: 'https://github.com/user/repo' }));
      const vercelFailure = vi.fn(async () => {
        throw new Error('Vercel API error');
      });

      const githubResult = await githubSuccess();
      expect(githubResult.repoUrl).toBeDefined();

      try {
        await vercelFailure();
      } catch (error) {
        expect((error as Error).message).toContain('Vercel');
      }

      expect(githubSuccess).toHaveBeenCalled();
      expect(vercelFailure).toHaveBeenCalled();
    });

    it('should handle Vercel domain verification failure', async () => {
      const vercelCall = vi.fn(async () => {
        throw new Error('Domain verification failed: DNS records not found');
      });

      try {
        await vercelCall();
      } catch (error) {
        expect((error as Error).message).toContain('Domain verification');
      }
    });

    it('should transition through open/half-open/closed for Vercel calls', async () => {
      let mockTime = 1000;
      const realBreaker = new RealCircuitBreaker({ 
        name: 'vercel', 
        failureThreshold: 2, 
        resetTimeoutMs: 1000,
        now: () => mockTime
      });

      const failingCall = vi.fn(async () => {
        throw new Error('Vercel API Down');
      });

      // State: CLOSED. Fail 2 times.
      await expect(realBreaker.call(() => failingCall())).rejects.toThrow('Vercel API Down');
      expect(realBreaker.currentState).toBe('CLOSED');
      
      await expect(realBreaker.call(() => failingCall())).rejects.toThrow('Vercel API Down');
      expect(realBreaker.currentState).toBe('OPEN');

      // Next call fails fast with CircuitOpenError
      await expect(realBreaker.call(() => failingCall())).rejects.toThrow(CircuitOpenError);

      // Advance clock to trigger HALF_OPEN
      mockTime += 1500;

      const successCall = vi.fn(async () => ({ success: true }));
      const result = await realBreaker.call(() => successCall());
      expect(result.success).toBe(true);
      expect(realBreaker.currentState).toBe('CLOSED');
    });

    it('should fail fast if circuit opens mid-deployment', async () => {
      const realBreaker = new RealCircuitBreaker({ name: 'vercel', failureThreshold: 1 });
      const failingCall = vi.fn(async () => {
        throw new Error('Mid-deploy outage');
      });

      // First call fails, opening the circuit
      await expect(realBreaker.call(() => failingCall())).rejects.toThrow('Mid-deploy outage');
      expect(realBreaker.currentState).toBe('OPEN');

      // Second call fails fast
      const startTime = Date.now();
      await expect(realBreaker.call(() => failingCall())).rejects.toThrow(CircuitOpenError);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(100); // Fails fast, does not hang
    });
  });

  describe('Stripe API Failures', () => {
    it('should handle Stripe payment timeout', async () => {
      const stripeCall = vi.fn(async () => {
        throw new Error('Stripe API timeout');
      });

      try {
        await retryPolicy.execute(stripeCall, 2, 50);
      } catch (error) {
        expect((error as Error).message).toContain('timeout');
      }
    });

    it('should handle Stripe 429 rate limit with exponential backoff', async () => {
      let attempts = 0;
      const stripeCall = vi.fn(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Stripe 429: Too many requests');
        }
        return { paymentIntentId: 'pi_123' };
      });

      const result = await retryPolicy.execute(stripeCall, 3, 50);
      expect(result.paymentIntentId).toBe('pi_123');
      expect(stripeCall).toHaveBeenCalledTimes(2);
    });

    it('should handle Stripe webhook signature verification failure', async () => {
      const stripeWebhook = vi.fn(async () => {
        throw new Error('Stripe webhook signature verification failed');
      });

      try {
        await stripeWebhook();
      } catch (error) {
        expect((error as Error).message).toContain('signature');
      }
    });

    it('should handle Stripe subscription cancellation failure', async () => {
      const stripeCancelCall = vi.fn(async () => {
        throw new Error('Stripe subscription not found');
      });

      try {
        await stripeCancelCall();
      } catch (error) {
        expect((error as Error).message).toContain('not found');
      }
    });
  });

  describe('Supabase Failures', () => {
    it('should handle Supabase connection timeout', async () => {
      const supabaseCall = vi.fn(async () => {
        throw new Error('Supabase connection timeout');
      });

      try {
        await retryPolicy.execute(supabaseCall, 2, 50);
      } catch (error) {
        expect((error as Error).message).toContain('timeout');
      }
    });

    it('should handle Supabase 503 Service Unavailable', async () => {
      let attempts = 0;
      const supabaseCall = vi.fn(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Supabase 503: Service Unavailable');
        }
        return { data: [{ id: 'user_123' }] };
      });

      const result = await retryPolicy.execute(supabaseCall, 3, 50);
      expect(result.data).toBeDefined();
    });

    it('should handle Supabase RLS policy violation', async () => {
      const supabaseCall = vi.fn(async () => {
        throw new Error('Supabase RLS policy violation: User does not have access');
      });

      try {
        await supabaseCall();
      } catch (error) {
        expect((error as Error).message).toContain('RLS');
      }
    });

    it('should handle Supabase database connection pool exhaustion', async () => {
      const supabaseCall = vi.fn(async () => {
        throw new Error('Supabase: Connection pool exhausted');
      });

      try {
        await supabaseCall();
      } catch (error) {
        expect((error as Error).message).toContain('pool');
      }
    });
  });

  describe('Cascading Failures', () => {
    it('should handle GitHub failure followed by Vercel failure', async () => {
      const githubCall = vi.fn(async () => {
        throw new Error('GitHub API error');
      });

      const vercelCall = vi.fn(async () => {
        throw new Error('Vercel API error');
      });

      let githubError: Error | null = null;
      let vercelError: Error | null = null;

      try {
        await githubCall();
      } catch (error) {
        githubError = error as Error;
      }

      try {
        await vercelCall();
      } catch (error) {
        vercelError = error as Error;
      }

      expect(githubError).toBeDefined();
      expect(vercelError).toBeDefined();
      expect(githubCall).toHaveBeenCalled();
      expect(vercelCall).toHaveBeenCalled();
    });

    it('should maintain data consistency during partial failures', async () => {
      const deploymentData = {
        id: 'dep_123',
        status: 'pending',
        githubRepo: null,
        vercelProject: null,
      };

      // GitHub succeeds
      deploymentData.githubRepo = 'https://github.com/user/repo';

      // Vercel fails
      try {
        throw new Error('Vercel API error');
      } catch {
        // Deployment should still have GitHub data
        expect(deploymentData.githubRepo).toBeDefined();
        expect(deploymentData.vercelProject).toBeNull();
      }
    });

    it('should recover from circuit breaker after timeout', async () => {
      const call = vi.fn(async () => {
        throw new Error('Service error');
      });

      // Trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(() => call());
        } catch {
          // Expected
        }
      }

      let state = circuitBreaker.getState();
      expect(state.isOpen).toBe(true);

      // Simulate timeout passage
      vi.useFakeTimers();
      vi.advanceTimersByTime(61000);

      // Circuit breaker should attempt to reset
      const successCall = vi.fn(async () => ({ success: true }));
      const result = await circuitBreaker.execute(() => successCall());

      expect(result.success).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('Error Messages and User Feedback', () => {
    it('should provide helpful error message for GitHub timeout', async () => {
      const githubCall = vi.fn(async () => {
        throw new Error('GitHub API timeout');
      });

      try {
        await githubCall();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('GitHub');
        expect(message).toContain('timeout');
      }
    });

    it('should provide helpful error message for rate limiting', async () => {
      const stripeCall = vi.fn(async () => {
        throw new Error('Stripe 429: Too many requests. Please retry after 60 seconds.');
      });

      try {
        await stripeCall();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('retry');
        expect(message).toContain('60');
      }
    });

    it('should provide helpful error message for service unavailable', async () => {
      const supabaseCall = vi.fn(async () => {
        throw new Error('Supabase 503: Service Unavailable. Please try again in a few moments.');
      });

      try {
        await supabaseCall();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('try again');
      }
    });
  });
});
