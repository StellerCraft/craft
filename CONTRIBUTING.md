# Contributing

This repository uses a monorepo layout (`apps/*`, `packages/*`) with tests and linting enforced before merge.

## General Workflow

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

## Snapshot Testing (Stellar Configuration)

Snapshot tests capture and diff configuration outputs to catch unintended changes in network settings, RPC endpoints, and serialization.

### Snapshot Files

Snapshots are stored in `__snapshots__` directories co-located with test files:

- `packages/stellar/src/__snapshots__/config.test.ts.snap`
- `apps/frontend/src/lib/stellar/__snapshots__/stellar-config-generator.test.ts.snap`

### Update Snapshots

When intentional changes are made to Stellar configuration (e.g., updating RPC endpoints, changing network passphrases), update snapshots:

```bash
npm run test -- --update-snapshots
```

Or for a specific test file:

```bash
npm run test -- packages/stellar/src/config.test.ts --update-snapshots
npm run test -- apps/frontend/src/lib/stellar/stellar-config-generator.test.ts --update-snapshots
```

### Snapshot Review

Always review snapshot diffs in your PR:

1. Run tests to see which snapshots changed
2. Verify the changes are intentional
3. Commit the updated snapshot files
4. Include a note in the PR description explaining why snapshots were updated

### When to Update Snapshots

- ✅ Intentional changes to network configuration (e.g., new RPC endpoint)
- ✅ Changes to environment variable serialization format
- ✅ Updates to generated file templates
- ❌ Do NOT update snapshots to hide unintended changes — investigate and fix the root cause

## Visual Regression Baselines (Deployment Preview)

Visual regression baselines for deployment preview templates are stored in:

- `apps/backend/tests/visual/baselines/deployment-preview/dex.baseline.json`
- `apps/backend/tests/visual/baselines/deployment-preview/defi.baseline.json`
- `apps/backend/tests/visual/baselines/deployment-preview/payment.baseline.json`
- `apps/backend/tests/visual/baselines/deployment-preview/asset.baseline.json`

### Compare Baselines

Run this in default mode to validate that generated screenshots remain within the allowed diff threshold:

```bash
npm run --workspace @craft/backend test -- tests/visual/preview.visual.test.ts
```

CI runs the same compare path in `.github/workflows/visual-regression.yml`. Any diff over threshold fails the job.

### Update Baselines

When intentional visual changes are made to deployment preview templates, regenerate and commit updated baselines:

```bash
VISUAL_BASELINE_MODE=store npm run --workspace @craft/backend test -- tests/visual/preview.visual.test.ts
```

On Windows PowerShell:

```powershell
$env:VISUAL_BASELINE_MODE='store'
npm run --workspace @craft/backend test -- tests/visual/preview.visual.test.ts
Remove-Item Env:VISUAL_BASELINE_MODE
```

### PR Expectations

1. Include before/after screenshots for each affected template category (`dex`, `defi`, `payment`, `asset`).
2. Keep baseline-only updates in small, reviewable commits.
3. Ensure baseline-missing failures are not bypassed; tests should fail with a clear missing-baseline message.

## Snapshot Regression Testing (Code Generation)

Snapshot tests for branding and code generation outputs are stored in:

- `apps/frontend/src/services/code-generator.snapshot.test.ts`

These tests verify that generated CSS variables, color schemes, and font configurations remain consistent across code generation runs.

### Compare Snapshots

Run snapshot tests in default mode to validate that generated code remains unchanged:

```bash
npm run --workspace @craft/frontend test -- code-generator.snapshot.test.ts
```

### Update Snapshots

When intentional changes are made to code generation logic (e.g., new branding variables, updated template structure), update snapshots:

```bash
npm run --workspace @craft/frontend test -- code-generator.snapshot.test.ts --update
```

Or use the shorthand:

```bash
npm run --workspace @craft/frontend test -- code-generator.snapshot.test.ts -u
```

### Snapshot Update Workflow

1. **Make code changes** to `CodeGeneratorService` or related generation logic.
2. **Run tests** to see which snapshots fail:
   ```bash
   npm run --workspace @craft/frontend test -- code-generator.snapshot.test.ts
   ```
3. **Review the diff** carefully to ensure changes are intentional:
   - Check that all branding variables are correct
   - Verify color schemes are properly escaped
   - Confirm font families are included
   - Ensure feature flags are correctly applied
4. **Update snapshots** if changes are correct:
   ```bash
   npm run --workspace @craft/frontend test -- code-generator.snapshot.test.ts -u
   ```
5. **Commit snapshot changes** in a separate commit with a clear message:
   ```bash
   git add apps/frontend/src/services/__snapshots__/
   git commit -m "test(branding): update snapshots for [reason]"
   ```

### PR Expectations for Snapshot Updates

1. Snapshot-only commits should be clearly labeled and separated from logic changes.
2. Include a description of why snapshots changed (e.g., "Added new branding variable", "Updated Stellar network URLs").
3. Ensure all 20+ branding configurations are tested and snapshots are updated.
4. Do not bypass snapshot failures; all diffs must be intentional and reviewed.
