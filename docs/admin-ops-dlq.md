# Admin Operations – Dead-Letter Queues

This document describes the two dead-letter-queue (DLQ) mechanisms used by the
CRAFT backend, explains the new combined view that surfaces both, and provides
runbooks for common operator workflows.

---

## Overview

A dead-letter queue (DLQ) captures work that has **permanently failed** after
exhausting all automatic retries. Entries in a DLQ require **manual
intervention** before the work is retried.

CRAFT maintains two entirely separate DLQ mechanisms because they back two
entirely separate execution pipelines:

| Mechanism | Source | Storage | Filled by |
|-----------|--------|---------|-----------|
| **webhook\_dlq** | Stripe + GitHub webhook delivery failures | In-memory (`Map`) per server process | `webhookDLQ.capture()` in `dead-letter-queue.ts` |
| **job\_dlq** | Background job failures | Supabase table `job_dlq` | `JobQueueService._failJob()` when `max_attempts` is exhausted |

Both represent the same conceptual state — *work that failed permanently and
needs manual intervention* — but they were built independently. The combined
view at `GET /api/admin/dlq` provides a single point of inspection.

---

## Mechanism 1 – webhook\_dlq (in-memory)

### Source code

```
apps/backend/src/lib/webhook-dlq/dead-letter-queue.ts
```

### What goes in

Any Stripe or GitHub webhook delivery that fails processing after `MAX_ATTEMPTS`
(currently 3) and after all exponential-backoff retries (`1m → 2m → … → 32m`)
are exhausted.

The `github/route.ts` and `stripe/route.ts` webhook handlers call
`webhookDLQ.capture(source, eventType, payload, reason, attempts)` when they
cannot process an event.

### Retry policy

Auto-recovery is built into the DLQ itself:

1. On `capture()`, a `scheduleRetry()` timer chain starts automatically.
2. Retry intervals: 1 min → 2 min → 4 min → 8 min → 16 min → 32 min.
3. Each interval has ±10% jitter.
4. **Circuit breaker**: 5 consecutive failures to the same endpoint pauses
   retries for 1 hour.
5. After all retries are exhausted the entry's `reprocessStatus` becomes
   `'failed'` permanently.

### Limitations

- **In-memory only**: entries are lost on process restart (server crash, deploy,
  scaling event). For high-reliability use cases, replace the `store` Map with
  a Redis or Supabase backing store.
- **Single-process**: the circuit breaker and in-flight dedup guard do not
  coordinate across horizontally scaled instances.

### Admin API

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/admin/webhooks/dlq` | List all webhook DLQ entries |
| `POST` | `/api/admin/webhooks/dlq` | Manually reprocess one entry (`{ id }` in body) |

The `GET` response now includes `_links.combinedDlq → /api/admin/dlq` to help
operators discover the combined view.

---

## Mechanism 2 – job\_dlq (Supabase-backed)

### Source code

```
apps/backend/src/services/job-queue.service.ts  (class JobQueueService)
supabase/migrations/014_job_queue.sql            (schema)
```

### What goes in

Background jobs (e.g., template deployments, email notifications) that fail
`max_attempts` times are moved to the `job_dlq` table and their `job_queue` row
is set to `status = 'dead'`.

Default `max_attempts` is `3` (`DEFAULT_MAX_ATTEMPTS`).

### Retry policy

`job_dlq` has no automatic retry. Each entry stays in `pending` reprocess
status until an operator calls `JobQueueService.reprocessDLQEntry(id)`, which
re-enqueues the original payload as a fresh `job_queue` row with a full new
`max_attempts` budget.

### Advantages over webhook\_dlq

- **Persistent**: survives server restarts (all state is in Supabase).
- **Multi-instance safe**: the claim RPC (`claim_next_job`) provides advisory
  locking so multiple worker instances cannot double-process the same job.

### Admin API

There is no dedicated single-source REST route for job\_dlq at this time.
Use the combined view or query the Supabase `job_dlq` table directly via the
Supabase dashboard or a service-role client.

---

## Combined View – GET /api/admin/dlq

### Purpose

A single admin endpoint that aggregates entries from both DLQ sources, tagged
by `source`, sorted by `createdAt` descending.

### Source code

```
apps/backend/src/app/api/admin/dlq/route.ts
```

### Authentication

Requires the caller to be an authenticated admin (`withRole('admin')`). The
existing per-source webhook DLQ route additionally requires a valid GitHub
webhook HMAC signature (`withGitHubWebhookAuth`); the combined route does not,
relying on role-based auth alone.

### Request

```http
GET /api/admin/dlq
Authorization: Bearer <admin-jwt>
```

### Response shape

```jsonc
{
  "total": 5,
  "bySource": {
    "webhook_dlq": 3,
    "job_dlq": 2
  },
  "entries": [
    {
      "source": "webhook_dlq",        // "webhook_dlq" | "job_dlq"
      "id": "dlq_1720000000000_abc1",
      "jobType": "stripe:invoice.payment_failed",
      "createdAt": "2026-08-27T11:00:00.000Z",
      "attempts": 3,
      "failureReason": "Stripe API unreachable",
      "reprocessStatus": "pending",   // "pending" | "in_progress" | "succeeded" | "failed"
      "reprocessedAt": null,
      "raw": { /* original DLQEntry or DLQRecord verbatim */ }
    },
    {
      "source": "job_dlq",
      "id": "8e3f1b2a-...",
      "jobType": "deploy:template",
      "createdAt": "2026-08-27T10:45:00.000Z",
      "attempts": 3,
      "failureReason": "Stellar Horizon unreachable",
      "reprocessStatus": "pending",
      "reprocessedAt": null,
      "raw": { /* original DLQRecord verbatim */ }
    }
    // …
  ],
  "_links": {
    "webhookDlq":    "/api/admin/webhooks/dlq",
    "webhookReplay": "/api/admin/webhooks/replay"
  }
}
```

### Partial-degradation behaviour

If `jobQueueService.listDLQ()` throws (e.g., Supabase is unreachable), the
route still returns an HTTP 200 with:

- All in-memory `webhook_dlq` entries intact
- `bySource.job_dlq = 0`
- An error logged to the server console at level `error`

This ensures a database outage does not prevent operators from inspecting
webhook DLQ state.

---

## GitHub Webhook Replay

### What is replay?

The replay mechanism allows an operator to re-process a previously failed or
missed GitHub webhook delivery without waiting for GitHub to re-send it.

### How it works

1. `POST /api/admin/webhooks/replay { deliveryId }` is called.
2. `WebhookDeliveryService.replayDelivery(originalDeliveryId)` runs:
   - Fetches the original delivery row from `github_webhook_deliveries`.
   - Inserts a **new row** with a new `delivery_id` (`replay-<ts>-<uuid>`)
     and `status = 'received'`.
   - Sets `replayed_from_delivery_id` on the new row to track the chain.
3. The new delivery row must then be **dispatched back through the GitHub webhook
   processing pipeline** to advance from `'received'` to `'processed'` or
   `'failed'`.

> ⚠️ **Known gap**: The current `WebhookDeliveryService.replayDelivery()`
> implementation only inserts the new row — it does **not** call the processing
> pipeline automatically. Until this wiring is added, replayed deliveries will
> remain at `status='received'` indefinitely.
>
> The integration test at
> `apps/backend/tests/webhooks/github-webhook-replay.integration.test.ts`
> documents this gap in the "gap exposure" test suite and serves as the
> acceptance criterion for the fix.

### Admin API

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/admin/webhooks/replay` | List deliveries available for replay |
| `POST` | `/api/admin/webhooks/replay` | Trigger replay of one or all deliveries |
| `PUT`  | `/api/admin/webhooks/replay` | Detect missed deliveries via GitHub API |

#### Replay a single delivery

```http
POST /api/admin/webhooks/replay
x-hub-signature-256: sha256=<hmac>
Content-Type: application/json

{ "deliveryId": "abc-123-def" }
```

#### Replay all failed deliveries

```http
POST /api/admin/webhooks/replay
x-hub-signature-256: sha256=<hmac>
Content-Type: application/json

{ "replayAll": true }
```

#### Detect missed deliveries

```http
PUT /api/admin/webhooks/replay
x-hub-signature-256: sha256=<hmac>
Content-Type: application/json

{ "hookId": 12345, "lookbackHours": 24 }
```

---

## Operator Runbooks

### Inspect all permanent failures

```bash
# Combined view — both sources in one call
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://your-app/api/admin/dlq

# Webhook DLQ only (in-memory)
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "x-hub-signature-256: sha256=$(echo -n '' | openssl dgst -sha256 -hmac $WEBHOOK_SECRET | cut -d' ' -f2)" \
     https://your-app/api/admin/webhooks/dlq
```

### Manually reprocess a webhook DLQ entry

```bash
curl -X POST \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "x-hub-signature-256: sha256=..." \
     -H "Content-Type: application/json" \
     -d '{"id":"dlq_1720000000000_abc1"}' \
     https://your-app/api/admin/webhooks/dlq
```

### Manually reprocess a job DLQ entry

Call `JobQueueService.reprocessDLQEntry(dlqId)` from a maintenance script or
add a REST endpoint for it. The method re-enqueues the original payload with
a fresh `max_attempts` budget.

### Replay a failed webhook delivery

```bash
# Get the delivery ID from the combined DLQ view first, then:
curl -X POST \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "x-hub-signature-256: sha256=..." \
     -H "Content-Type: application/json" \
     -d '{"deliveryId":"original-delivery-id"}' \
     https://your-app/api/admin/webhooks/replay
```

---

## Architecture Notes

### Why two separate DLQ mechanisms?

The two DLQs exist independently because:

1. **Different storage**: The webhook DLQ predates Supabase persistence and was
   built as an in-memory fast-path; the job DLQ was built database-first for
   durability.
2. **Different retry semantics**: Webhooks have built-in exponential backoff and
   circuit breakers per endpoint; jobs simply count attempts and escalate.
3. **No merging required**: The combined admin view satisfies the operator
   visibility need without requiring a data migration or storage unification.

### Future improvements

- Replace the in-memory webhook DLQ store with Supabase or Redis to survive
  restarts and support horizontal scaling.
- Add a REST endpoint for `JobQueueService.reprocessDLQEntry()`.
- Wire `WebhookDeliveryService.replayDelivery()` to automatically dispatch the
  replayed delivery through the GitHub webhook processing pipeline.
- Add alerting when either DLQ count exceeds a configured threshold.
