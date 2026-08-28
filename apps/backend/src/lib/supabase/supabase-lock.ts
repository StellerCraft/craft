import { createClient } from './server';

/**
 * Acquires a Supabase advisory lock using pg_try_advisory_lock with a polling
 * loop until the lock is acquired or the timeout elapses.
 *
 * Returns true if the lock was acquired, false if the timeout expired.
 */
export async function acquireAdvisoryLock(key: string, timeoutMs: number): Promise<boolean> {
    const supabase = createClient();
    const lockId = hashKey(key);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const { data, error } = await supabase.rpc('pg_try_advisory_lock', { lock_id: lockId });
        if (error) throw new Error(`Advisory lock error: ${error.message}`);
        if (data === true) return true;
        // Brief sleep before retry to avoid tight loop
        await sleep(100);
    }
    return false;
}

/**
 * Releases a previously acquired advisory lock.
 */
export async function releaseAdvisoryLock(key: string): Promise<void> {
    const supabase = createClient();
    const lockId = hashKey(key);
    await supabase.rpc('pg_advisory_unlock', { lock_id: lockId });
}

/** Deterministically map a string key to a 32-bit integer lock ID. */
function hashKey(key: string): number {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
    }
    // Convert to unsigned 32-bit so Postgres bigint won't get negative values
    return hash >>> 0;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
