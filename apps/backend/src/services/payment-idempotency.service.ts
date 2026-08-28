import { createClient } from '@/lib/supabase/server';
import { randomBytes } from 'crypto';

/**
 * Payment Idempotency Service
 *
 * Manages idempotency keys for Stripe payment operations to ensure
 * that retried operations do not create duplicate charges.
 *
 * Idempotency keys are stored in the database and include:
 * - Unique key per operation
 * - Stripe API response for caching
 * - Expiration time (24 hours)
 *
 * Usage:
 *   const key = await idempotencyService.generateKey(userId, 'checkout_session');
 *   const response = await stripe.checkout.sessions.create({...}, {idempotencyKey: key});
 *   await idempotencyService.storeResponse(key, response);
 */

export class PaymentIdempotencyService {
  /**
   * Return an existing unexpired idempotency key for this logical operation,
   * or mint and persist a new one if none exists.
   *
   * Retried calls for the same (userId, operationType[, requestFingerprint])
   * within the 24-hour expiry window will receive the same key, allowing
   * Stripe to short-circuit to its cached response rather than processing a
   * duplicate charge.
   *
   * @param userId           - The user initiating the payment operation.
   * @param operationType    - The type of payment operation.
   * @param requestFingerprint - Optional caller-supplied fingerprint that
   *   further distinguishes otherwise identical operations (e.g. a hash of
   *   cart contents). When provided, two calls with different fingerprints
   *   for the same user/operation will each get their own key.
   */
  async generateKey(
    userId: string,
    operationType: 'checkout_session' | 'subscription' | 'cancel' | 'update',
    requestFingerprint?: string,
  ): Promise<string> {
    const supabase = createClient();
    const now = new Date().toISOString();

    // ── 1. Look up an existing, unexpired key for this logical operation ──────
    let lookupQuery = supabase
      .from('payment_idempotency_keys')
      .select('idempotency_key')
      .eq('user_id', userId)
      .eq('operation_type', operationType)
      .gt('expires_at', now);

    if (requestFingerprint) {
      lookupQuery = lookupQuery.eq('request_fingerprint', requestFingerprint);
    }

    const { data: existing, error: lookupError } = await lookupQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // PGRST116 = "no rows returned" — that is the expected cache-miss path.
    if (lookupError && lookupError.code !== 'PGRST116') {
      throw new Error(`Failed to look up idempotency key: ${lookupError.message}`);
    }

    if (existing?.idempotency_key) {
      return existing.idempotency_key;
    }

    // ── 2. No unexpired key found — mint and persist a new one ────────────────
    const key = this.generateRandomKey();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      idempotency_key: key,
      operation_type: operationType,
      expires_at: expiresAt.toISOString(),
    };

    if (requestFingerprint) {
      insertPayload.request_fingerprint = requestFingerprint;
    }

    const { error: insertError } = await supabase
      .from('payment_idempotency_keys')
      .insert(insertPayload);

    if (insertError) {
      throw new Error(`Failed to generate idempotency key: ${insertError.message}`);
    }

    return key;
  }

  /**
   * Retrieve an existing idempotency key and its cached response.
   * Returns null if the key doesn't exist or has expired.
   */
  async getKey(userId: string, key: string) {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('payment_idempotency_keys')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error && error.code === 'PGRST116') {
      return null;
    }

    if (error) {
      throw new Error(`Failed to retrieve idempotency key: ${error.message}`);
    }

    return data;
  }

  /**
   * Store the Stripe API response for an idempotency key.
   * This allows retried requests to return the cached response.
   */
  async storeResponse(key: string, response: any): Promise<void> {
    const supabase = createClient();

    const { error } = await supabase
      .from('payment_idempotency_keys')
      .update({
        stripe_response: response,
      })
      .eq('idempotency_key', key);

    if (error) {
      throw new Error(`Failed to store idempotency response: ${error.message}`);
    }
  }

  /**
   * Clean up expired idempotency keys.
   * Should be called periodically (e.g., via cron job).
   */
  async cleanupExpiredKeys(): Promise<number> {
    const supabase = createClient();

    const { data, error } = await supabase
      .from('payment_idempotency_keys')
      .delete()
      .lt('expires_at', new Date().toISOString());

    if (error) {
      throw new Error(`Failed to cleanup idempotency keys: ${error.message}`);
    }

    return data?.length ?? 0;
  }

  /**
   * Generate a random idempotency key.
   * Format: idempotency_<random-hex>_<timestamp>
   */
  private generateRandomKey(): string {
    const randomPart = randomBytes(16).toString('hex');
    const timestamp = Date.now();
    return `idempotency_${randomPart}_${timestamp}`;
  }
}

export const paymentIdempotencyService = new PaymentIdempotencyService();
