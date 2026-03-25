# Design Document: customization-payload-tests

## Overview

This design covers the test architecture for the customization payload lifecycle. The goal is to fill the remaining coverage gaps in the `CustomizationDraftService` (Requirements 1, 2, and 3) without touching the already-passing test files.

The existing tests cover:
- `validateCustomizationConfig` schema and business rules (Requirements 4 & 5)
- `validateBrandingFile` (Requirement 9)
- Network config PBT (partial Requirement 3 coverage)
- `normalizeDraftConfig` unit tests (Requirement 3 unit coverage)
- All API route handlers (Requirements 6, 7, 8)

What remains is service-layer tests for `saveDraft`, `getDraft`, and `getDraftByDeployment`, plus a property-based test for `normalizeDraftConfig` idempotency.

---

## Architecture

The test suite follows a two-layer mock strategy:

**Route tests** (already written): mock the entire service via `vi.mock('@/services/customization-draft.service', ...)` so route logic is tested in isolation from DB concerns.

**Service tests** (to be added): mock only the Supabase client via `vi.mock('@/lib/supabase/server', ...)` so service logic is tested against a controlled DB interface. The service methods call `createClient()` internally, so the mock intercepts at that boundary.

```
Route handler
  └── withAuth (mocked via supabase server mock)
        └── CustomizationDraftService (mocked at service level for route tests)
              └── createClient() (mocked at supabase level for service tests)
                    └── Supabase query chain
```

---

## Components and Interfaces

### Files to extend / create

| File | Action | Covers |
|------|--------|--------|
| `apps/web/src/services/customization-draft.service.test.ts` | Extend (add `saveDraft` and `getDraft`/`getDraftByDeployment` describe blocks) | Requirements 1, 2 |
| `apps/web/src/services/customization-draft.service.property.test.ts` | Create new | Requirement 3 (PBT) |

### Supabase mock chain pattern

The service uses chained Supabase calls. Each chain must be mocked to return the right shape. The pattern used throughout this codebase:

```typescript
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ auth: { getUser: mockGetUser }, from: mockFrom }),
}));
```

For service tests, `mockFrom` returns a builder object whose methods are also mocks. Each test configures the chain for its specific scenario.

#### saveDraft chain

`saveDraft` makes two sequential `from()` calls:

1. Template lookup: `from('templates').select('id').eq('id', ...).eq('is_active', true).single()`
2. Upsert: `from('customization_drafts').upsert(..., { onConflict: ... }).select().single()`

Mock setup for the happy path:

```typescript
const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ single: mockSingle }));
const mockEq = vi.fn(() => ({ eq: mockEq, single: mockSingle, select: mockSelect }));
const mockUpsert = vi.fn(() => ({ select: mockSelect }));

mockFrom.mockImplementation((table: string) => {
    if (table === 'templates') return { select: () => ({ eq: mockEq }) };
    if (table === 'customization_drafts') return { upsert: mockUpsert };
});
```

#### getDraft chain

`from('customization_drafts').select('*').eq('user_id', ...).eq('template_id', ...).single()`

#### getDraftByDeployment chain

First call: `from('deployments').select('template_id, user_id').eq('id', ...).single()`  
Then delegates to `getDraft` (same chain as above).

---

## Data Models

### CustomizationDraft (returned by service methods)

```typescript
interface CustomizationDraft {
    id: string;
    userId: string;
    templateId: string;
    customizationConfig: CustomizationConfig;
    createdAt: Date;
    updatedAt: Date;
}
```

### DB row shape (what Supabase returns before `mapRow`)

```typescript
{
    id: string;
    user_id: string;
    template_id: string;
    customization_config: unknown;  // raw JSONB
    created_at: string;
    updated_at: string;
}
```

`mapRow` converts snake_case to camelCase and passes `customization_config` through `normalizeDraftConfig`.

### Test fixtures

```typescript
const fakeUser = { id: 'user-1' };
const templateId = 'tmpl-1';
const deploymentId = 'dep-1';

const validConfig: CustomizationConfig = {
    branding: { appName: 'DEX', primaryColor: '#f00', secondaryColor: '#0f0', fontFamily: 'Inter' },
    features: { enableCharts: true, enableTransactionHistory: true, enableAnalytics: false, enableNotifications: false },
    stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
};

const fakeRow = {
    id: 'draft-1',
    user_id: fakeUser.id,
    template_id: templateId,
    customization_config: validConfig,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
};
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: normalizeDraftConfig is idempotent

*For any* value (including null, undefined, partial objects, and complete configs), applying `normalizeDraftConfig` twice produces the same result as applying it once.

Formally: `normalizeDraftConfig(normalizeDraftConfig(x))` deep-equals `normalizeDraftConfig(x)` for all `x`.

This subsumes Requirements 3.1 (complete config preserved), 3.2 (partial config filled), 3.3 (null handled), and 3.4 (empty object handled) — because if the function is idempotent, it must be stable on its own output, which means defaults are applied exactly once and user values are never overwritten on a second pass.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 2: User-supplied values always win over defaults

*For any* config object with at least one user-supplied field, `normalizeDraftConfig` preserves that field's value unchanged in the output.

Formally: for any `raw` where `raw.branding.appName` is defined, `normalizeDraftConfig(raw).branding.appName === raw.branding.appName`. The same holds for all other user-supplied fields across `branding`, `features`, and `stellar`.

**Validates: Requirements 3.5**

### Property 3: Output always has all required top-level keys

*For any* input (including null, undefined, empty object, or arbitrary object), `normalizeDraftConfig` always returns an object with exactly the keys `branding`, `features`, and `stellar`, each being a non-null object.

**Validates: Requirements 3.2, 3.3, 3.4**

**Property Reflection**: Properties 2 and 3 are distinct — Property 1 (idempotence) does not directly imply Property 2 (user values win), because a function that always returns defaults would be idempotent but wrong. Property 3 (structural completeness) is implied by idempotence only if the first application produces a complete object, which is what Property 3 asserts. All three are kept as they each provide unique validation value.

---

## Error Handling

### Service-layer error taxonomy

| Scenario | Method | Error / Return |
|----------|--------|----------------|
| Template lookup fails or returns no row | `saveDraft` | throws `'Template not found'` |
| Upsert returns Supabase error | `saveDraft` | throws `'Failed to save draft: <message>'` |
| No draft row (PGRST116) | `getDraft` | returns `null` |
| Other Supabase error | `getDraft` | throws `'Failed to get draft: <message>'` |
| Deployment not found (PGRST116) | `getDraftByDeployment` | returns `null` |
| Deployment belongs to different user | `getDraftByDeployment` | throws `'Forbidden'` |

Tests must assert both the error type (thrown vs. null return) and the exact message string or prefix.

---

## Testing Strategy

### Dual testing approach

Unit tests cover specific examples, error paths, and call-argument assertions. Property tests cover universal invariants across randomly generated inputs. Both are required for comprehensive coverage.

### Unit tests — `customization-draft.service.test.ts` (extension)

Add two new `describe` blocks to the existing file:

**`describe('saveDraft')`**
- Returns a `CustomizationDraft` on success (Requirement 1.1)
- Throws `'Template not found'` when template lookup fails (Requirement 1.2)
- Throws `'Failed to save draft: ...'` when upsert errors (Requirement 1.3)
- Passes `onConflict: 'user_id,template_id'` to upsert (Requirement 1.4)

**`describe('getDraft')`**
- Returns normalized draft when row exists (Requirement 2.1)
- Returns `null` on PGRST116 error (Requirement 2.2)
- Throws `'Failed to get draft: ...'` on other errors (Requirement 2.3)

**`describe('getDraftByDeployment')`**
- Throws `'Forbidden'` when `user_id` mismatches (Requirement 2.4)
- Returns `null` when deployment not found (Requirement 2.5)

### Property tests — `customization-draft.service.property.test.ts` (new file)

Uses `fast-check` (already a project dependency, used in `validate-network.property.test.ts`).

**Arbitraries needed:**
- `arbAnyInput`: `fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant({}), fc.record({ branding: fc.record({...}), ... }))` — covers the full range of inputs including edge cases
- `arbPartialConfig`: generates objects with random subsets of the config keys present
- `arbCompleteConfig`: generates fully-populated configs with all fields

**Property test 1 — idempotence** (Property 1):
```
// Feature: customization-payload-tests, Property 1: normalizeDraftConfig is idempotent
fc.assert(fc.property(arbAnyInput, (raw) => {
    const once = normalizeDraftConfig(raw);
    const twice = normalizeDraftConfig(once);
    expect(twice).toEqual(once);
}), { numRuns: 100 });
```

**Property test 2 — user values preserved** (Property 2):
```
// Feature: customization-payload-tests, Property 2: user-supplied values always win over defaults
fc.assert(fc.property(arbCompleteConfig, (config) => {
    const result = normalizeDraftConfig(config);
    expect(result.branding.appName).toBe(config.branding.appName);
    // ... assert all user-supplied fields
}), { numRuns: 100 });
```

**Property test 3 — structural completeness** (Property 3):
```
// Feature: customization-payload-tests, Property 3: output always has all required top-level keys
fc.assert(fc.property(arbAnyInput, (raw) => {
    const result = normalizeDraftConfig(raw);
    expect(result).toHaveProperty('branding');
    expect(result).toHaveProperty('features');
    expect(result).toHaveProperty('stellar');
    expect(typeof result.branding).toBe('object');
    expect(typeof result.features).toBe('object');
    expect(typeof result.stellar).toBe('object');
}), { numRuns: 100 });
```

**Configuration**: minimum 100 iterations per property test (`numRuns: 100`), consistent with the existing `validate-network.property.test.ts`.

### Test framework

- Unit tests: Vitest (`describe`, `it`, `expect`, `vi.fn`, `vi.mock`, `beforeEach`)
- Property tests: Vitest + fast-check (`fc.assert`, `fc.property`, arbitraries)
- File naming: `*.test.ts` for unit, `*.property.test.ts` for PBT
