# Webhook Dead Letter Queue (DLQ)

## Overview

When a webhook event (Stripe or GitHub) fails to process after `MAX_ATTEMPTS` (3) retries, the full original payload and failure reason are captured in the Dead Letter Queue instead of being silently dropped.

## DLQ Workflow

```
Webhook received
       │
  verify signature
       │
  attempt processing ──► success ──► 200 OK
       │ (up to 3x)
       ▼ all attempts failed
  capture to DLQ ──► 200 OK (so provider stops retrying)
       │
  ┌────┴────────────────────────────┐
  │                                 │
  ▼                                 ▼
Admin-triggered                Automatic retry
reprocess via                  (via scheduleRetry()
POST /api/admin/               and DLQAutoRecovery
webhooks/dlq                   poll loop)
  │                                 │
  └──────┬──────────────────────────┘
         ▼
  processor re-runs ──► success: entry marked succeeded
                    └──► failure: entry marked failed, reason updated
```

Two overlapping but distinct retry paths exist:
- **`webhookDLQ.scheduleRetry()`** — called inline immediately after a failed capture attempt. Manages a single entry through its full exponential-backoff schedule (1m / 2m / 4m / 8m / 16m / 32m) with ±10% jitter.
- **`DLQAutoRecovery`** — a background polling orchestrator that scans all pending entries at a configurable interval (default 30s) and retries those whose `nextRetryAt` has elapsed. This provides resilience for entries that may have been missed by `scheduleRetry()` or added via admin reprocess.

## Automatic Retry Schedule

When a DLQ entry is first captured, or when `DLQAutoRecovery` picks it up, it progresses through the following retry schedule:

| Attempt | Base Delay | Total Window |
|---------|-----------|--------------|
| 1       | 1 minute  | 1 minute     |
| 2       | 2 minutes | 3 minutes    |
| 3       | 4 minutes | 7 minutes    |
| 4       | 8 minutes | 15 minutes   |
| 5       | 16 minutes| 31 minutes   |
| 6       | 32 minutes| 63 minutes   |

Each delay includes ±10% jitter (applied via `calculateBackoffDelay`). After all 6 attempts are exhausted, the entry is marked as permanently failed and will not be retried automatically again.

## Circuit Breaker

A per-endpoint circuit breaker (keyed by `source:eventType`) protects downstream services from sustained load during outages:

- **Threshold:** 5 consecutive failures to the same endpoint (`CIRCUIT_BREAKER_THRESHOLD`) trip the circuit from CLOSED to OPEN.
- **Pause duration:** 1 hour (`CIRCUIT_BREAKER_RESET_MS` / `CIRCUIT_BREAKER_PAUSE_MS`). After this window, the circuit transitions to HALF_OPEN and allows a single probe request.
- **Recovery:** If the probe succeeds, the circuit returns to CLOSED. If it fails, it returns to OPEN and the 1-hour timer resets.

When the circuit is OPEN, `scheduleRetry()` and `DLQAutoRecovery` skip retries for that endpoint and log:
```
[DLQ] Circuit open, skipping retry
[dlq-recovery] circuit state change  { circuitKey: "stripe:invoice.payment_failed", from: "CLOSED", to: "OPEN" }
```

After all retries are exhausted:
```
[dlq-recovery] Permanent failure after max retries  { id: "dlq_...", source: "stripe", eventType: "invoice.payment_failed" }
```

## DLQAutoRecovery Configuration

The `DLQAutoRecovery` orchestrator (defined in `src/lib/webhook-dlq/dlq-auto-recovery.ts`) exposes the following configuration surface via `DLQRecoveryConfig`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pollIntervalMs` | `number` | `30_000` | How often (ms) the background loop scans for retryable entries |
| `now` | `() => number` | `Date.now` | Injectable clock for testing |
| `sleep` | `(ms: number) => Promise<void>` | real sleep | Injectable sleep for testing |
| `onCircuitStateChange` | `(name, from, to) => void` | undefined | Callback invoked on every circuit state transition |

The orchestrator is started/stopped via:
- **`start()`** — begins the background polling loop (idempotent; safe to call multiple times)
- **`stop()`** — stops the polling loop and clears any pending timer
- **`processDue()`** — runs a single scan pass over all pending entries (useful for tests and cron-style invocations)

## DLQ Entry Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique DLQ entry ID (`dlq_<timestamp>_<random>`) |
| `source` | `stripe` \| `github` | Webhook origin |
| `eventType` | string | Event type (e.g. `invoice.payment_failed`, `push`) |
| `payload` | string | Full original raw JSON payload |
| `failureReason` | string | Error message from the last failed attempt |
| `attempts` | number | Number of processing attempts made before capture |
| `createdAt` | ISO 8601 | When the entry was captured |
| `reprocessedAt` | ISO 8601 \| undefined | When reprocessing was last attempted |
| `reprocessStatus` | `pending` \| `succeeded` \| `failed` | Outcome of latest reprocess attempt |

## Admin Endpoints

Both endpoints require the `admin` role (see [RBAC docs](./rbac-admin-middleware.md)).

### `GET /api/admin/webhooks/dlq`

Returns all DLQ entries sorted newest-first.

```json
{
  "total": 1,
  "entries": [
    {
      "id": "dlq_1716900000000_abc1234",
      "source": "stripe",
      "eventType": "invoice.payment_failed",
      "payload": "{...}",
      "failureReason": "Payment service unavailable",
      "attempts": 3,
      "createdAt": "2024-05-28T12:00:00.000Z",
      "reprocessStatus": "pending"
    }
  ]
}
```

### `POST /api/admin/webhooks/dlq`

Reprocess a single DLQ entry.

**Request body:**
```json
{ "id": "dlq_1716900000000_abc1234" }
```

**Response (success):**
```json
{ "success": true, "entry": { ...updated entry... } }
```

**Response (failure):**
```json
{ "error": "Payment service unavailable", "entry": { ...entry with failed status... } }
```

## Preventing Infinite Loops

- Each entry can only be marked `succeeded` once; reprocessing a succeeded entry returns a 422.
- Automatic retries follow the bounded exponential-backoff schedule above (max 6 attempts, ~63 minute window). After all retries are exhausted, the entry is permanently failed and is not retried automatically again.
- The circuit breaker (5 consecutive failures → 1-hour pause) provides an additional safety layer by preventing rapid retry loops against a failing endpoint.
- An operator can always manually trigger reprocessing via `POST /api/admin/webhooks/dlq` for any entry in `pending` or `failed` status.

## Production Recommendations

The current backing store is in-process memory, suitable for single-instance deployments. For multi-instance or durable storage requirements:

1. Replace the `Map` in `src/lib/webhook-dlq/dead-letter-queue.ts` with a Supabase table or Redis sorted set.
2. Add a database migration to create a `webhook_dlq` table with columns matching `DLQEntry`.
3. Verify that `DLQAutoRecovery` is started in the running service (e.g., during application boot). The retry/circuit-breaker constants (`RETRY_INTERVALS_MS`, `CIRCUIT_BREAKER_THRESHOLD`, `CIRCUIT_BREAKER_RESET_MS`) are defined in `dead-letter-queue.ts`; the circuit-breaker constants in `dlq-auto-recovery.ts` mirror them.
