# Contributing

This repository uses a monorepo layout (`apps/*`, `packages/*`) with tests and linting enforced before merge.

## General Workflow

- The `apps/backend/scratch/` directory is ignored via `.gitignore`.
1. Create a focused branch for your issue.
2. Keep changes scoped and reviewable.
3. Add or update tests with behavior changes.
4. Run checks locally before opening a PR:

```bash
npm run test
npm run lint
npm run build
```

5. Link the PR to the relevant issue.

## Continuous Integration

Every pull request runs the `CI` workflow defined in `.github/workflows/ci.yml`.
It installs dependencies with `npm ci`, then runs `npm run lint` and `npm test`
on the Node version declared in the root `package.json` `engines` field. The
workflow uses the default read-only `GITHUB_TOKEN` permissions. Make sure these
same checks pass locally before requesting review.

Dependabot proposes weekly version updates for npm workspace dependencies and
GitHub Actions. Security updates are managed separately in the repository's
GitHub settings.

## URL-synced filters

List pages with user-facing filters (search, status, category, …) keep their
filter state in the URL query string so filtered views are shareable and
survive a refresh. Follow the same pattern everywhere instead of re-deriving it:

- **Read** the initial state from `useSearchParams()` (or a Server Component's
  `searchParams` prop passed down as `initialFilters`), falling back to defaults
  for missing or unknown values.
- **Hold** the live state in React; keep the filter UI itself a controlled
  component that only receives `filters` and `onChange`.
- **Write** changes back with a debounced `router.replace(url, { scroll: false })`
  — `replace`, not `push`, and omit default values from the query string.

Reference implementation: `DeploymentFiltersBar`
(`apps/frontend/src/components/deployments/DeploymentFiltersBar.tsx`) — its
JSDoc `@example` shows the pattern end-to-end.

`TemplateCatalogFilters`
(`apps/frontend/src/components/app/templates/TemplateCatalogFilters.tsx`) and
its page already sync to the URL but without debouncing; aligning it with this
convention is a candidate for a future issue.

## Rate Limiting, Idempotency, and Tier Enforcement

Several backend middleware modules read tunable behavior from environment
variables or module-level constants. This section is the single reference
for all of them; each source file below points back here.

### `RATE_LIMIT_DISABLED`

- **Read by:** `apps/backend/src/lib/api/with-rate-limit.ts`, `apps/backend/src/lib/api/tier-rate-limit.ts`
- **Default:** unset (rate limiting enforced)
- **Effect:** when set to the string `"true"`, bypasses sliding-window and tier-based rate limiting entirely. Intended for local development and CI, where generous production limits would otherwise add friction.

### `IDEMPOTENCY_TTL_MS`

- **Read by:** `apps/backend/src/lib/api/idempotency.ts`
- **Default:** `86400000` (24 hours)
- **Effect:** how long a cached response for a given `(userId, Idempotency-Key)` pair is replayed instead of re-executing the handler. Falls back to the default when unset, non-numeric, or `<= 0`.

### `SCOPE_VALIDATION_CACHE_TTL_MS`

- **Read by:** `apps/backend/src/lib/github/scope-validator.ts`
- **Default:** `300000` (5 minutes)
- **Effect:** how long a validated GitHub token-scope result is cached (keyed by a SHA-256 hash of the token) before being re-checked against the GitHub API.

### `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`

- **Read by:** `apps/backend/src/services/email-delivery.service.ts`
- **Default:** unset
- **Effect:** configure the transactional email provider used to send templated emails (deployment completion, subscription changes, security alerts, invoices).
  - `EMAIL_API_URL` — base URL of the email API (e.g. `https://api.resend.com`).
  - `EMAIL_API_KEY` — API key sent as a bearer token to the provider.
  - `EMAIL_FROM` — sender address (e.g. `notifications@craft.app`); defaults to `notifications@craft.app` when unset.
  - **Dev-mode fallback:** when `EMAIL_API_URL` is unset, `EmailDeliveryService` does not call any provider — it logs the rendered subject/recipient to the console and returns a synthetic `dev-<to>-<subject>` message id instead. This is intentional for local development and CI. If emails are not being delivered in a staging or production environment, check that `EMAIL_API_URL` is actually set before treating it as a bug.

### Tier-limit constants

These are not environment variables — they are constants defined directly in
source, listed here so all tunable rate-limiting/tier behavior has one
reference page.

- `apps/backend/src/lib/api/tier-rate-limit.ts`:
  - `GENERAL_TIER_LIMITS` — per-tier request budget for regular endpoints: free 100/min, pro 1000/min, enterprise 10000/min.
  - `SENSITIVE_TIER_LIMITS` — stricter per-tier budget applied to endpoints matched by `isSensitiveEndpoint()` (auth, payments, checkout, subscription, deployment creation): free 10/min, pro 100/min, enterprise 1000/min.
- `apps/backend/src/lib/tier-enforcement.middleware.ts`:
  - `TIER_ORDER` — numeric ordering used to compare a user's tier against a route's required tier (`free: 0`, `pro: 1`, `enterprise: 2`).
  - `FEATURE_GATES` — declarative map from route-pattern substrings to the minimum subscription tier required to access them.

## Middleware Composition Order

`with-auth.ts`, `with-role.ts`, `with-validation.ts`, `with-rate-limit.ts`, and
`with-usage-tracking.ts` are designed to be composed on a single route. Nesting
order matters for correctness, not just style:

1. **`withRateLimit` outermost.** It's the cheapest check (keyed by IP/route, no
   DB auth lookup) and should reject abusive traffic before any auth or
   validation work happens. See existing routes such as `api/auth/signin`.
2. **`withAuth` before `withRole`.** Role/tier enforcement needs a verified
   user id to check against — `withRole` (and any future tier-enforcement
   wrapper) must run only once identity is established.
3. **`withValidation` after auth/role.** Validate the request body once the
   caller is known to be authenticated and permitted; this avoids paying
   Zod-parsing cost for requests that were going to be rejected anyway.
4. **`withUsageTracking` innermost, closest to the handler.** It should only
   fire for requests that passed every other check and actually executed.
   This is also why it must sit *outside* idempotency handling for a given
   operation: a replayed idempotent request should be served from the
   idempotency cache and must **not** re-trigger usage tracking, or metered
   usage gets double-counted for a single logical operation.

Putting it together, the recommended nesting (outer → inner) is:

```
withRateLimit(...)(
  withAuth(
    withRole('admin', ...)          // or another tier/role check, if needed
    withValidation(schema)(
      withUsageTracking(operationType)(handler)
    )
  )
)
```

See each module's own docstring for a runnable composition example.

## Database Migrations

Supabase migrations live in `supabase/migrations/` and are applied in filename sort order.

### Numbering Convention

Every new migration file must be named:

```text
NNN_short_snake_case_description.sql
```

- `NNN` is a three-digit, zero-padded prefix (e.g. `022`).
- Use the **next unused** prefix: one higher than the highest prefix currently in `supabase/migrations/` on `main`.
- Each prefix belongs to exactly one migration file. Never reuse an existing prefix, even for a related change.
- Rebase on `main` right before opening your PR and renumber if another PR has claimed your prefix in the meantime.
- Include `-- rollback:` comment lines describing how to undo the migration, matching the existing files.

Some older files share a prefix (for example `010_*`, `014_*`, `016_*`). These are historical collisions kept as-is because renaming an applied migration changes its identity; do not add new files to those prefixes.

### Check for Collisions

The collision-guard script `scripts/check-migration-numbering.js` fails if a new migration reuses an existing prefix or breaks the naming pattern. CI runs the same check. Run it locally before opening a PR:

```bash
node scripts/check-migration-numbering.js
```

### PR Expectations

1. The migration filename follows the convention above and the collision guard passes.
2. The PR description names the new migration file and its prefix.
3. Migrations that depend on another migration's objects note that dependency in the file header.

## Snapshot

/* … truncated 5600 chars — edit only what you need near the top … */
