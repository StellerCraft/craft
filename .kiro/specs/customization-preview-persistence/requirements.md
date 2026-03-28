# Requirements Document

## Introduction

This feature proves that customization data produces stable, deterministic preview inputs and can be saved and loaded without loss. It covers three tightly coupled concerns:

1. **Preview stability** — given the same `CustomizationConfig`, the `PreviewService` must always produce structurally identical output (branding, features, mock data, CSS, viewport metadata).
2. **Persistence round-trip** — a `CustomizationConfig` written to the `customization_drafts` table and read back must be semantically equivalent to the original.
3. **Normalization safety** — partial or stale drafts loaded from the database must always be safe to hand to the UI without crashing on missing fields.

The feature adds property-based tests, example-based tests, and any missing service/API behaviour needed to satisfy these guarantees. It does not change the public API surface or database schema.

---

## Glossary

- **CustomizationConfig**: The TypeScript type `{ branding, features, stellar }` defined in `@craft/types` and validated by `customizationConfigSchema` in `src/lib/customization/validate.ts`.
- **PreviewService**: The class in `src/services/preview.service.ts` that generates preview payloads from a `CustomizationConfig`.
- **PreviewPayload**: The object returned by `PreviewService.generatePreview`, containing `customization`, `mockData`, and `timestamp` (legacy shape) or `branding`, `features`, `mockData`, `css`, `viewport` (current shape).
- **CustomizationDraftService**: The class in `src/services/customization-draft.service.ts` that persists and retrieves drafts via Supabase.
- **Draft**: A row in the `customization_drafts` table keyed by `(user_id, template_id)`.
- **normalizeDraftConfig**: The pure function in `customization-draft.service.ts` that deep-merges a raw JSONB value with safe defaults.
- **Validator**: The `validateCustomizationConfig` function in `src/lib/customization/validate.ts`.
- **ValidationResult**: `{ valid: boolean, errors: ValidationError[] }` — the stable contract returned by the Validator.
- **EARS**: Easy Approach to Requirements Syntax — the pattern set used to write acceptance criteria.

---

## Requirements

### Requirement 1: Preview Payload Stability

**User Story:** As a developer integrating the preview iframe, I want the `PreviewService` to produce identical output for the same input, so that I can cache previews and avoid unnecessary re-renders.

#### Acceptance Criteria

1. THE `PreviewService` SHALL produce a `PreviewPayload` whose `customization` (or `branding`, `features`, `stellar`) fields are structurally equal to the input `CustomizationConfig` for every valid input.
2. WHEN `PreviewService.generatePreview` is called twice with the same `CustomizationConfig` and the same viewport class, THE `PreviewService` SHALL return payloads that are structurally equal in all scalar fields (`css`, `viewport.width`, `viewport.height`, `branding.*`, `features.*`).
3. THE `PreviewService` SHALL return a `mockData` object that is reference-equal to the static fixture `STATIC_MOCK_DATA` for every call, proving no dynamic fetch occurred.
4. WHEN `PreviewService.generateAllViewports` is called with any valid `CustomizationConfig`, THE `PreviewService` SHALL return a result containing exactly the keys `desktop`, `tablet`, and `mobile`, each holding a valid `PreviewPayload`.
5. THE `PreviewService` SHALL generate CSS that contains the `primaryColor`, `secondaryColor`, and `fontFamily` values from the input `CustomizationConfig` for every valid input.
6. WHEN `PreviewService.generateAllViewports` is called with any valid `CustomizationConfig`, THE `PreviewService` SHALL return payloads whose `css` field is identical across all three viewport entries.

---

### Requirement 2: Preview Viewport Ordering Invariant

**User Story:** As a UI developer, I want viewport dimensions to follow a strict ordering, so that responsive layout logic can rely on `desktop > tablet > mobile` without special-casing.

#### Acceptance Criteria

1. THE `PreviewService` SHALL assign a `viewport.width` to `desktop` that is strictly greater than the `viewport.width` assigned to `tablet` for every call to `generateAllViewports`.
2. THE `PreviewService` SHALL assign a `viewport.width` to `tablet` that is strictly greater than the `viewport.width` assigned to `mobile` for every call to `generateAllViewports`.
3. THE `PreviewService` SHALL assign a `containerMaxWidth` that is less than or equal to `viewport.width` for every viewport class.
4. THE `PreviewService` SHALL assign a `gridColumns` value to `desktop` that is strictly greater than the `gridColumns` value assigned to `tablet`.
5. THE `PreviewService` SHALL assign a `gridColumns` value to `tablet` that is strictly greater than the `gridColumns` value assigned to `mobile`.
6. WHEN the viewport class is `desktop`, THE `PreviewService` SHALL set `sidebarCollapsed` to `false` in the layout metadata.
7. WHEN the viewport class is `tablet` or `mobile`, THE `PreviewService` SHALL set `sidebarCollapsed` to `true` in the layout metadata.

---

### Requirement 3: Mock Data Isolation

**User Story:** As a security reviewer, I want the preview system to never make real Stellar network requests, so that preview generation cannot leak credentials or incur unexpected costs.

#### Acceptance Criteria

1. THE `PreviewService` SHALL source all `mockData` exclusively from the static in-memory fixture `STATIC_MOCK_DATA` and SHALL NOT call any Stellar SDK or HTTP client during `generatePreview`.
2. THE `PreviewService` SHALL return `mockData` that is identical across all viewport classes for the same `CustomizationConfig`.
3. THE `PreviewService` SHALL return `mockData.recentTransactions` as a non-empty array for every call.
4. THE `PreviewService` SHALL return `mockData.assetPrices` as an object where every value is a finite positive number for every call.
5. THE `PreviewService` SHALL return `mockData.accountBalance` as a non-empty string for every call.
6. WHEN `PreviewService.generatePreview` is called with two different `CustomizationConfig` values that share the same `stellar.network`, THE `PreviewService` SHALL return `mockData` objects that are reference-equal.

---

### Requirement 4: Customization Config Normalization

**User Story:** As a backend developer, I want partial or stale drafts loaded from the database to always be safe to use, so that missing fields never cause runtime errors in the UI.

#### Acceptance Criteria

1. WHEN `normalizeDraftConfig` is called with `null` or `undefined`, THE `normalizeDraftConfig` function SHALL return a `CustomizationConfig` equal to the default config without throwing.
2. WHEN `normalizeDraftConfig` is called with an empty object `{}`, THE `normalizeDraftConfig` function SHALL return a `CustomizationConfig` equal to the default config.
3. WHEN `normalizeDraftConfig` is called with a partial `branding` object that omits some fields, THE `normalizeDraftConfig` function SHALL fill the missing fields with their default values while preserving the provided fields.
4. WHEN `normalizeDraftConfig` is called with a complete `CustomizationConfig`, THE `normalizeDraftConfig` function SHALL return a value structurally equal to the input.
5. THE `normalizeDraftConfig` function SHALL always return an object with all three top-level keys (`branding`, `features`, `stellar`) present and non-null for any input.
6. FOR ALL valid `CustomizationConfig` objects `c`, `normalizeDraftConfig(normalizeDraftConfig(c))` SHALL be structurally equal to `normalizeDraftConfig(c)` (idempotence).

---

### Requirement 5: Draft Persistence Round-Trip

**User Story:** As a user, I want my customization settings to be saved and restored exactly, so that I never lose work between sessions.

#### Acceptance Criteria

1. WHEN `CustomizationDraftService.saveDraft` is called with a valid `CustomizationConfig` and then `CustomizationDraftService.getDraft` is called with the same `userId` and `templateId`, THE `CustomizationDraftService` SHALL return a draft whose `customizationConfig` is structurally equal to the saved config (round-trip property).
2. WHEN `CustomizationDraftService.saveDraft` is called twice for the same `(userId, templateId)` pair with different configs, THE `CustomizationDraftService` SHALL retain only the most recent config and `getDraft` SHALL return the second config.
3. WHEN `CustomizationDraftService.getDraft` is called for a `(userId, templateId)` pair that has no saved draft, THE `CustomizationDraftService` SHALL return `null`.
4. WHEN `CustomizationDraftService.saveDraft` is called with a `templateId` that does not exist in the `templates` table, THE `CustomizationDraftService` SHALL throw an error with the message `'Template not found'`.
5. WHEN `CustomizationDraftService.getDraftByDeployment` is called with a `deploymentId` that belongs to a different user, THE `CustomizationDraftService` SHALL throw an error with the message `'Forbidden'`.
6. THE `CustomizationDraftService` SHALL store `customization_config` as JSONB and retrieve it via `normalizeDraftConfig` so that the returned `customizationConfig` always satisfies the `CustomizationConfig` shape.

---

### Requirement 6: Draft API Persistence Contract

**User Story:** As a frontend developer, I want the draft API endpoints to enforce validation before persisting, so that only structurally valid configs are ever written to the database.

#### Acceptance Criteria

1. WHEN `POST /api/drafts/[templateId]` receives a valid `CustomizationConfig` body from an authenticated user, THE `Drafts_API` SHALL persist the draft and return HTTP 200 with the saved draft object.
2. WHEN `POST /api/drafts/[templateId]` receives a body that fails `validateCustomizationConfig`, THE `Drafts_API` SHALL return HTTP 400 with a `details` array of field-level errors and SHALL NOT write to the database.
3. WHEN `POST /api/drafts/[templateId]` receives a valid body but the `templateId` does not exist, THE `Drafts_API` SHALL return HTTP 404.
4. WHEN `GET /api/drafts/[templateId]` is called by an authenticated user with an existing draft, THE `Drafts_API` SHALL return HTTP 200 with the draft object including `id`, `customizationConfig`, `createdAt`, and `updatedAt`.
5. WHEN `GET /api/drafts/[templateId]` is called by an authenticated user with no existing draft, THE `Drafts_API` SHALL return HTTP 404.
6. WHEN any draft endpoint is called without a valid session, THE `Drafts_API` SHALL return HTTP 401.
7. WHEN `GET /api/drafts/deployment/[deploymentId]` is called by a user who does not own the deployment, THE `Drafts_API` SHALL return HTTP 403.

---

### Requirement 7: Preview API Stability Contract

**User Story:** As a frontend developer, I want the preview API to return a stable, validated payload, so that the iframe renderer can trust the shape of the response.

#### Acceptance Criteria

1. WHEN `POST /api/preview` receives a valid `CustomizationConfig` body from an authenticated user, THE `Preview_API` SHALL return HTTP 200 with a payload containing `customization`, `mockData`, and `timestamp`.
2. WHEN `POST /api/preview` receives the same valid `CustomizationConfig` body in two separate requests, THE `Preview_API` SHALL return payloads whose `customization` fields are structurally equal.
3. WHEN `POST /api/preview` receives a body that fails `validateCustomizationConfig`, THE `Preview_API` SHALL return HTTP 422 with an `error` field and a `details` array.
4. WHEN `POST /api/preview` receives a body with a `stellar.network`/`stellar.horizonUrl` mismatch, THE `Preview_API` SHALL return HTTP 422 with a `details` entry whose `code` is `HORIZON_NETWORK_MISMATCH`.
5. WHEN `POST /api/preview` receives malformed JSON, THE `Preview_API` SHALL return HTTP 400 with `{ "error": "Invalid JSON" }`.
6. WHEN `POST /api/preview` is called without a valid session, THE `Preview_API` SHALL return HTTP 401.
7. THE `Preview_API` SHALL return a `timestamp` field that is a valid ISO 8601 date string for every successful response.

---

### Requirement 8: Validation Stability

**User Story:** As a developer consuming the validation API, I want `validateCustomizationConfig` to return a stable, deterministic result, so that the same input always produces the same `ValidationResult`.

#### Acceptance Criteria

1. THE `Validator` SHALL return `{ valid: true, errors: [] }` for every structurally correct `CustomizationConfig` with matching network/horizonUrl and distinct primary/secondary colors.
2. THE `Validator` SHALL return `{ valid: false, errors: [{ code: 'HORIZON_NETWORK_MISMATCH', field: 'stellar.horizonUrl' }] }` for every config where `stellar.network` is `mainnet` and `stellar.horizonUrl` is the testnet URL, or vice versa.
3. THE `Validator` SHALL return `{ valid: false, errors: [{ code: 'DUPLICATE_COLORS', field: 'branding.secondaryColor' }] }` for every config where `branding.primaryColor` equals `branding.secondaryColor`.
4. WHEN `validateCustomizationConfig` is called twice with the same input, THE `Validator` SHALL return structurally equal `ValidationResult` objects (determinism).
5. THE `Validator` SHALL return a `ValidationResult` where `errors` is an empty array whenever `valid` is `true`, for every input.
6. THE `Validator` SHALL return a `ValidationResult` where `errors` is a non-empty array whenever `valid` is `false`, for every input.
