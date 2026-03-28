# Implementation Plan: Customization Preview Persistence

## Overview

Harden the `PreviewService`, `CustomizationDraftService`, and `validateCustomizationConfig` with property-based tests and any missing service behaviour needed to satisfy the correctness guarantees in the design. The design uses TypeScript throughout.

## Tasks

- [ ] 1. Refactor `PreviewService` to match the design contract
  - [ ] 1.1 Update `preview.service.ts` to export the new `generatePreview(config, viewport?)`, `generateAllViewports(config)`, `generatePreviewCss(config)`, `deriveLayoutMetadata(viewport)`, `STATIC_MOCK_DATA`, `VIEWPORT_CLASSES`, and `VIEWPORT_DIMENSIONS` exports described in the design
    - The current `PreviewService.generatePreview` takes `(template, savedConfig?)` — replace with `(config: CustomizationConfig, viewport?: ViewportClass): PreviewPayload`
    - `PreviewPayload` must have `branding`, `features`, `mockData`, `css`, `viewport`, `timestamp` fields
    - `STATIC_MOCK_DATA` must be a module-level constant (no network calls)
    - `generateAllViewports` must return `Record<ViewportClass, PreviewPayload>`
    - `deriveLayoutMetadata` must return `LayoutMetadata` with `viewportClass`, `viewport`, `containerMaxWidth`, `gridColumns`, `sidebarCollapsed`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1–2.7, 3.1–3.6_

  - [ ]* 1.2 Write property tests for `PreviewService` — Properties 1–11
    - Create `apps/web/src/services/preview.service.property.test.ts` (replace existing file)
    - **Property 1: Config Preservation** — `generatePreview` payload `branding`/`features` equal input config — **Validates: Requirements 1.1**
    - **Property 2: Preview Determinism** — two calls with same args return structurally equal scalar fields — **Validates: Requirements 1.2**
    - **Property 3: Mock Data Isolation** — `mockData` is reference-equal to `STATIC_MOCK_DATA`, no Stellar SDK calls — **Validates: Requirements 1.3, 3.1, 3.2, 3.6**
    - **Property 4: All-Viewports Completeness** — `generateAllViewports` returns exactly `desktop`, `tablet`, `mobile` keys — **Validates: Requirements 1.4**
    - **Property 5: CSS Contains Branding Values** — `generatePreviewCss` output contains `primaryColor`, `secondaryColor`, `fontFamily` — **Validates: Requirements 1.5**
    - **Property 6: CSS Is Viewport-Invariant** — `css` field is identical across all three viewport entries — **Validates: Requirements 1.6**
    - **Property 7: Viewport Width Ordering** — `desktop.viewport.width > tablet.viewport.width > mobile.viewport.width` — **Validates: Requirements 2.1, 2.2**
    - **Property 8: Container Fits Viewport** — `deriveLayoutMetadata` returns `containerMaxWidth <= viewport.width` — **Validates: Requirements 2.3**
    - **Property 9: Grid Column Ordering** — `desktop.gridColumns > tablet.gridColumns > mobile.gridColumns` — **Validates: Requirements 2.4, 2.5**
    - **Property 10: Sidebar Collapsed Invariant** — `sidebarCollapsed` is `false` for desktop, `true` for tablet/mobile — **Validates: Requirements 2.6, 2.7**
    - **Property 11: Mock Data Structural Completeness** — `recentTransactions` non-empty, `assetPrices` values finite positive, `accountBalance` non-empty string — **Validates: Requirements 3.3, 3.4, 3.5**
    - Use `arbCustomizationConfig` from the design document as the canonical arbitrary
    - Each test must include `// Feature: customization-preview-persistence, Property N: <title>`

- [ ] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Harden `normalizeDraftConfig` and add property tests
  - [ ] 3.1 Verify `normalizeDraftConfig` in `customization-draft.service.ts` satisfies all design properties
    - Confirm it handles `null`, `undefined`, `{}`, and partial objects without throwing
    - Confirm it is idempotent: `normalizeDraftConfig(normalizeDraftConfig(x))` equals `normalizeDraftConfig(x)`
    - Confirm it preserves provided fields while filling missing ones with defaults
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 3.2 Write property tests for `normalizeDraftConfig` — Properties 12–14
    - Create `apps/web/src/services/customization-draft.property.test.ts`
    - **Property 12: Normalization Structural Completeness** — any input returns object with `branding`, `features`, `stellar` present and non-null — **Validates: Requirements 4.1, 4.2, 4.5**
    - **Property 13: Normalization Preserves Provided Fields** — partial input preserves provided fields, fills missing with defaults — **Validates: Requirements 4.3**
    - **Property 14: Normalization Idempotence** — `normalizeDraftConfig(normalizeDraftConfig(c))` equals `normalizeDraftConfig(c)` — **Validates: Requirements 4.4, 4.6**
    - Each test must include `// Feature: customization-preview-persistence, Property N: <title>`

- [ ] 4. Add property tests for draft persistence round-trip — Properties 15–16
  - [ ]* 4.1 Write property tests for `CustomizationDraftService` persistence
    - Add to `apps/web/src/services/customization-draft.property.test.ts`
    - **Property 15: Draft Persistence Round-Trip** — `saveDraft` then `getDraft` returns config structurally equal to saved config — **Validates: Requirements 5.1, 5.6**
    - **Property 16: Draft Upsert Overwrites Previous** — saving `c1` then `c2` for same `(userId, templateId)` results in `getDraft` returning `c2` — **Validates: Requirements 5.2**
    - Mock Supabase client for deterministic in-memory behaviour
    - Each test must include `// Feature: customization-preview-persistence, Property N: <title>`

- [ ] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Add property tests for `validateCustomizationConfig` — Properties 17–21
  - [ ]* 6.1 Write property tests for the validator
    - Create `apps/web/src/lib/customization/validate.property.test.ts`
    - **Property 17: Invalid Config Rejected by Draft API** — any body failing `validateCustomizationConfig` causes `POST /api/drafts/[templateId]` to return 400 with `details` and not call `saveDraft` — **Validates: Requirements 6.2**
    - **Property 18: Validator Valid/Errors Consistency** — `errors` is empty iff `valid` is `true` — **Validates: Requirements 8.5, 8.6**
    - **Property 19: Validator Accepts All Valid Configs** — any config with matching network/horizonUrl and distinct colors returns `{ valid: true, errors: [] }` — **Validates: Requirements 8.1**
    - **Property 20: Validator Rejects Network Mismatch** — mismatched network/horizonUrl returns `{ valid: false, errors: [{ code: 'HORIZON_NETWORK_MISMATCH' }] }` — **Validates: Requirements 8.2**
    - **Property 21: Validator Rejects Duplicate Colors** — `primaryColor === secondaryColor` returns `{ valid: false, errors: [{ code: 'DUPLICATE_COLORS' }] }` — **Validates: Requirements 8.3**
    - Use `arbCustomizationConfig` from the design document
    - Each test must include `// Feature: customization-preview-persistence, Property N: <title>`

- [ ] 7. Fill gaps in unit tests for `CustomizationDraftService`
  - [ ] 7.1 Extend `apps/web/src/services/customization-draft.service.test.ts` with missing example-based tests
    - Test `getDraft` returns `null` when no draft exists — _Requirements: 5.3_
    - Test `saveDraft` throws `'Template not found'` for non-existent templateId — _Requirements: 5.4_
    - Test `getDraftByDeployment` throws `'Forbidden'` when deployment belongs to a different user — _Requirements: 5.5_
    - _Requirements: 5.3, 5.4, 5.5_

- [ ] 8. Fill gaps in unit tests for the draft API route
  - [ ] 8.1 Extend `apps/web/src/app/api/drafts/[templateId]/route.test.ts` with any missing coverage
    - Verify `POST` returns 200 with `id`, `customizationConfig`, `createdAt`, `updatedAt` on valid input — _Requirements: 6.1_
    - Verify `GET` returns 200 with full draft object when draft exists — _Requirements: 6.4_
    - Verify `GET` returns 404 when no draft exists — _Requirements: 6.5_
    - Verify any endpoint returns 401 without a valid session — _Requirements: 6.6_
    - Verify `GET /api/drafts/deployment/[deploymentId]` returns 403 when user does not own deployment — _Requirements: 6.7_
    - Verify `POST` with non-existent templateId returns 404 — _Requirements: 6.3_
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.7_

- [ ] 9. Fill gaps in unit tests for the preview API route
  - [ ] 9.1 Extend `apps/web/src/app/api/preview/route.test.ts` with any missing coverage
    - Verify `POST` returns 200 with `customization`, `mockData`, `timestamp` on valid input — _Requirements: 7.1_
    - Verify `POST` returns 422 with `error` and `details` for invalid config — _Requirements: 7.3_
    - Verify `POST` returns 422 with `HORIZON_NETWORK_MISMATCH` code for network mismatch — _Requirements: 7.4_
    - Verify `POST` returns 400 with `{ error: 'Invalid JSON' }` for malformed JSON — _Requirements: 7.5_
    - Verify `POST` returns 401 without a valid session — _Requirements: 7.6_
    - Verify `timestamp` is a valid ISO 8601 string — _Requirements: 7.7_
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 7.7_

- [ ] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` (`^3.15.0`) with `{ numRuns: 100 }` minimum
- All property test files must include the comment `// Feature: customization-preview-persistence, Property N: <title>`
- The canonical `arbCustomizationConfig` arbitrary is defined in the design document — use it as-is in all new property test files
