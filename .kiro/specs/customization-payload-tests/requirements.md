# Requirements Document

## Introduction

This feature adds unit tests for the customization payload lifecycle: saving drafts, loading drafts, validating payloads, and rejecting invalid or unauthorized payloads. The tests cover the `CustomizationDraftService`, the `validateCustomizationConfig` function, the `validateBrandingFile` utility, and the API routes that expose these operations (`POST /api/drafts/[templateId]`, `GET /api/drafts/[templateId]`, `GET /api/drafts/deployment/[deploymentId]`, and `POST /api/customization/validate`). All tests must fit the existing Vitest monorepo structure under `apps/web`.

## Glossary

- **CustomizationConfig**: The typed payload describing branding, feature flags, and Stellar network settings for a deployment.
- **Draft**: A persisted, user-owned `CustomizationConfig` keyed by `(userId, templateId)`, stored in the `customization_drafts` Supabase table.
- **Validator**: The `validateCustomizationConfig` function in `src/lib/customization/validate.ts`.
- **DraftService**: The `CustomizationDraftService` class in `src/services/customization-draft.service.ts`.
- **BrandingFileValidator**: The `validateBrandingFile` function in `src/lib/customization/validate-branding-file.ts`.
- **ValidationResult**: The `{ valid: boolean; errors: ValidationError[] }` object returned by the Validator.
- **Route**: A Next.js App Router handler file (`route.ts`) under `apps/web/src/app/api/`.
- **withAuth**: The authentication middleware wrapper used by all protected routes.

---

## Requirements

### Requirement 1: Save Draft — Service Layer

**User Story:** As a developer, I want unit tests for `CustomizationDraftService.saveDraft`, so that I can be confident drafts are persisted correctly and edge cases are handled.

#### Acceptance Criteria

1. WHEN `saveDraft` is called with a valid `userId`, `templateId`, and `CustomizationConfig`, THE DraftService SHALL upsert the record and return a `CustomizationDraft` with matching fields.
2. WHEN `saveDraft` is called and the template does not exist in the database, THE DraftService SHALL throw an error with the message `'Template not found'`.
3. WHEN `saveDraft` is called and the Supabase upsert returns an error, THE DraftService SHALL throw an error whose message begins with `'Failed to save draft'`.
4. WHEN `saveDraft` is called with a valid config, THE DraftService SHALL pass `onConflict: 'user_id,template_id'` to the upsert so that only one draft per user per template is kept.

---

### Requirement 2: Load Draft — Service Layer

**User Story:** As a developer, I want unit tests for `CustomizationDraftService.getDraft` and `getDraftByDeployment`, so that I can be confident drafts are retrieved correctly and missing or forbidden cases are handled.

#### Acceptance Criteria

1. WHEN `getDraft` is called and a matching row exists, THE DraftService SHALL return a `CustomizationDraft` with `customizationConfig` normalized through `normalizeDraftConfig`.
2. WHEN `getDraft` is called and no row exists (Supabase error code `PGRST116`), THE DraftService SHALL return `null`.
3. WHEN `getDraft` is called and Supabase returns a non-`PGRST116` error, THE DraftService SHALL throw an error whose message begins with `'Failed to get draft'`.
4. WHEN `getDraftByDeployment` is called and the deployment's `user_id` does not match the requesting `userId`, THE DraftService SHALL throw an error with the message `'Forbidden'`.
5. WHEN `getDraftByDeployment` is called and the deployment does not exist, THE DraftService SHALL return `null`.

---

### Requirement 3: Normalize Draft Config

**User Story:** As a developer, I want unit tests for `normalizeDraftConfig`, so that I can be confident partial or stale JSONB payloads are always safe to render in the UI.

#### Acceptance Criteria

1. WHEN `normalizeDraftConfig` is called with a complete config object, THE DraftService SHALL return the config with all provided values preserved.
2. WHEN `normalizeDraftConfig` is called with a partial config missing some branding fields, THE DraftService SHALL fill the missing fields with the defined defaults.
3. WHEN `normalizeDraftConfig` is called with `null` or `undefined`, THE DraftService SHALL return the full default `CustomizationConfig`.
4. WHEN `normalizeDraftConfig` is called with an empty object, THE DraftService SHALL return the full default `CustomizationConfig`.
5. THE DraftService SHALL preserve user-supplied values over defaults when both are present.

---

### Requirement 4: Validate Customization Config — Schema Rules

**User Story:** As a developer, I want unit tests for `validateCustomizationConfig` schema validation, so that I can be confident all structural field errors are caught and reported with correct field paths and codes.

#### Acceptance Criteria

1. WHEN `validateCustomizationConfig` is called with a fully valid `CustomizationConfig`, THE Validator SHALL return `{ valid: true, errors: [] }`.
2. WHEN `validateCustomizationConfig` is called with an empty `branding.appName`, THE Validator SHALL return `valid: false` with an error whose `field` is `'branding.appName'`.
3. WHEN `validateCustomizationConfig` is called with `branding.appName` exceeding 60 characters, THE Validator SHALL return `valid: false` with an error whose `field` is `'branding.appName'`.
4. WHEN `validateCustomizationConfig` is called with a `branding.primaryColor` that is not a valid hex color, THE Validator SHALL return `valid: false` with an error whose `field` is `'branding.primaryColor'` and `code` is `'INVALID_STRING'`.
5. WHEN `validateCustomizationConfig` is called with an invalid `branding.logoUrl`, THE Validator SHALL return `valid: false` with an error whose `field` is `'branding.logoUrl'`.
6. WHEN `validateCustomizationConfig` is called with a `stellar.network` value outside `['mainnet', 'testnet']`, THE Validator SHALL return `valid: false` with an error whose `field` is `'stellar.network'`.
7. WHEN `validateCustomizationConfig` is called with an invalid `stellar.horizonUrl`, THE Validator SHALL return `valid: false` with an error whose `field` is `'stellar.horizonUrl'`.
8. WHEN `validateCustomizationConfig` is called with `null`, THE Validator SHALL return `valid: false` with at least one error.

---

### Requirement 5: Validate Customization Config — Business Rules

**User Story:** As a developer, I want unit tests for `validateCustomizationConfig` business rule enforcement, so that I can be confident cross-field invariants are caught after schema validation passes.

#### Acceptance Criteria

1. WHEN `validateCustomizationConfig` is called with `stellar.network: 'mainnet'` and `stellar.horizonUrl` pointing to the testnet endpoint, THE Validator SHALL return `valid: false` with an error whose `code` is `'HORIZON_NETWORK_MISMATCH'` and `field` is `'stellar.horizonUrl'`.
2. WHEN `validateCustomizationConfig` is called with `stellar.network: 'testnet'` and `stellar.horizonUrl` pointing to the mainnet endpoint, THE Validator SHALL return `valid: false` with an error whose `code` is `'HORIZON_NETWORK_MISMATCH'`.
3. WHEN `validateCustomizationConfig` is called with `branding.primaryColor` equal to `branding.secondaryColor`, THE Validator SHALL return `valid: false` with an error whose `code` is `'DUPLICATE_COLORS'` and `field` is `'branding.secondaryColor'`.
4. WHEN `validateCustomizationConfig` is called with a valid mainnet config (`network: 'mainnet'`, `horizonUrl: 'https://horizon.stellar.org'`), THE Validator SHALL return `{ valid: true, errors: [] }`.

---

### Requirement 6: Reject Invalid Payloads — API Route (Validate Endpoint)

**User Story:** As a developer, I want unit tests for `POST /api/customization/validate`, so that I can be confident the route correctly delegates to the Validator and returns the right HTTP status codes.

#### Acceptance Criteria

1. WHEN an unauthenticated request is sent to `POST /api/customization/validate`, THE Route SHALL return HTTP 401.
2. WHEN an authenticated request with a valid `CustomizationConfig` body is sent, THE Route SHALL return HTTP 200 with `{ valid: true, errors: [] }`.
3. WHEN an authenticated request with an invalid config body is sent, THE Route SHALL return HTTP 422 with `valid: false` and a non-empty `errors` array.
4. WHEN an authenticated request with a body that is not valid JSON is sent, THE Route SHALL return HTTP 400 with `{ error: 'Invalid JSON' }`.
5. WHEN an authenticated request triggers a business rule violation (e.g., `HORIZON_NETWORK_MISMATCH`), THE Route SHALL return HTTP 422 with the matching error `code` in the response body.

---

### Requirement 7: Save Draft — API Route

**User Story:** As a developer, I want unit tests for `POST /api/drafts/[templateId]`, so that I can be confident the route validates the payload, delegates to the DraftService, and returns correct status codes.

#### Acceptance Criteria

1. WHEN an unauthenticated request is sent to `POST /api/drafts/[templateId]`, THE Route SHALL return HTTP 401.
2. WHEN an authenticated request with a valid config is sent and the template exists, THE Route SHALL return HTTP 200 with the saved draft object.
3. WHEN an authenticated request with an invalid config is sent, THE Route SHALL return HTTP 400 with `{ error: 'Invalid input', details: [...] }`.
4. WHEN an authenticated request is sent and the template does not exist, THE Route SHALL return HTTP 404.
5. WHEN an authenticated request with a body that is not valid JSON is sent, THE Route SHALL return HTTP 400 with `{ error: 'Invalid JSON' }`.

---

### Requirement 8: Load Draft — API Routes

**User Story:** As a developer, I want unit tests for `GET /api/drafts/[templateId]` and `GET /api/drafts/deployment/[deploymentId]`, so that I can be confident drafts are returned correctly and access control is enforced.

#### Acceptance Criteria

1. WHEN an unauthenticated request is sent to `GET /api/drafts/[templateId]`, THE Route SHALL return HTTP 401.
2. WHEN an authenticated request is sent and a draft exists for the user and template, THE Route SHALL return HTTP 200 with the draft object.
3. WHEN an authenticated request is sent and no draft exists, THE Route SHALL return HTTP 404 with `{ error: 'Draft not found' }`.
4. WHEN an unauthenticated request is sent to `GET /api/drafts/deployment/[deploymentId]`, THE Route SHALL return HTTP 401.
5. WHEN an authenticated request is sent to `GET /api/drafts/deployment/[deploymentId]` and the deployment belongs to a different user, THE Route SHALL return HTTP 403.
6. WHEN an authenticated request is sent to `GET /api/drafts/deployment/[deploymentId]` and no draft exists for the resolved template, THE Route SHALL return HTTP 404.

---

### Requirement 9: Branding File Validation

**User Story:** As a developer, I want unit tests for `validateBrandingFile`, so that I can be confident only safe, correctly-typed image files are accepted.

#### Acceptance Criteria

1. WHEN `validateBrandingFile` is called with a valid PNG file (correct MIME type, extension, size, and magic bytes), THE BrandingFileValidator SHALL return `{ valid: true }`.
2. WHEN `validateBrandingFile` is called with a MIME type not in the allowlist, THE BrandingFileValidator SHALL return `valid: false` with `code: 'INVALID_MIME_TYPE'`.
3. WHEN `validateBrandingFile` is called with a file extension not in the allowlist, THE BrandingFileValidator SHALL return `valid: false` with `code: 'INVALID_EXTENSION'`.
4. WHEN `validateBrandingFile` is called with a file whose size exceeds 2 MB, THE BrandingFileValidator SHALL return `valid: false` with `code: 'FILE_TOO_LARGE'`.
5. WHEN `validateBrandingFile` is called with a file whose magic bytes do not match the declared MIME type, THE BrandingFileValidator SHALL return `valid: false` with `code: 'MAGIC_BYTES_MISMATCH'`.
6. WHEN `validateBrandingFile` is called with an SVG file containing a `<script>` tag, THE BrandingFileValidator SHALL return `valid: false` with `code: 'UNSAFE_SVG'`.
7. WHEN `validateBrandingFile` is called with a valid SVG file (contains `<svg`, no scripts, no event handlers), THE BrandingFileValidator SHALL return `{ valid: true }`.
8. WHEN `validateBrandingFile` is called with a MIME type and extension that do not match (e.g., `image/png` with `.jpg`), THE BrandingFileValidator SHALL return `valid: false` with `code: 'MIME_EXTENSION_MISMATCH'`.
