# Template Catalog Browsing Experience

Design specification for the template discovery flow at `/app/templates`.

---

## Layout

```
┌─────────────────────────────────────────────────────────┐
│  Template Catalog                                        │
│  Browse and select from our collection of templates.     │
├─────────────────────────────────────────────────────────┤
│  [🔍 Search templates…]   [All][DEX][Lending][Payment]  │
│                           [Asset Issuance]               │
├─────────────────────────────────────────────────────────┤
│  4 templates found                                       │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Card     │  │ Card     │  │ Card     │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
```

---

## Filter Controls

### Search

- Placement: top-left of the filter bar, `max-w-md`, full-width on mobile.
- Input type: `type="search"` with a leading magnifying-glass icon.
- `aria-label="Search templates"`, `placeholder="Search templates…"`.
- Debounce: 300 ms before the query is applied and the URL is updated.
- Matches against template `name` and `description`.

### Category Chips

- Placement: right of the search input on ≥ sm screens; wraps below on mobile.
- Options: **All** (clears filter) · **DEX** · **Lending** · **Payment** · **Asset Issuance**.
- Each chip is a `<button>` with `aria-pressed` reflecting active state.
- Active chip: `primary-gradient` background, `text-on-primary`.
- Inactive chip: `bg-surface-container-low`, `border border-outline-variant/20`.
- Clicking an already-active category chip deselects it (returns to All).
- The group carries `role="group" aria-label="Filter by category"`.

### Sort

Sort is not exposed in the current UI. Templates are returned in server-defined order (active templates, seeded via migration). A sort control may be added in a future iteration.

### URL Persistence

Active filters are serialised into the URL query string (`?category=dex&search=stellar`) so that the state survives page reload and can be shared via link.

---

## Card Anatomy

```
┌────────────────────────────────┐
│  [Preview image / icon]        │  ← aspect-video, lazy-loaded
│  ┌─ Category badge ─┐          │  ← top-left overlay, primary bg
│  └──────────────────┘          │
├────────────────────────────────┤
│  Template Name                 │  ← font-headline, font-bold
│  Short description (2 lines)   │  ← line-clamp-2, text-on-surface-variant
│                                │
│  ─────────────────────────── │
│  N features enabled  [Use →]   │  ← feature count + CTA button
└────────────────────────────────┘
```

| Element | Detail |
|---|---|
| Preview area | `aspect-video`; shows `previewImageUrl` if set, otherwise a category emoji fallback |
| Category badge | Absolute-positioned top-left; label from `CATEGORY_LABELS` map |
| Name | `<h3>`, `font-headline font-bold text-on-surface`; hover transitions to `text-on-primary-container` |
| Description | `text-sm text-on-surface-variant`, `line-clamp-2` |
| Feature count | Count of `features` where `enabled === true`; pluralised |
| CTA | `<button>` "Use Template" with chevron icon; `aria-label="Use {name} template"` |

The card is an `<article>` with hover shadow and border transition (`hover:shadow-lg hover:border-outline-variant/25`).

---

## States

### Loading

- Shown while the API request is in flight.
- Renders 6 skeleton cards in the same 3-column grid.
- Each skeleton mirrors the card structure with `animate-pulse` placeholder blocks.
- The grid has `role="status" aria-label="Loading templates"` and a visually-hidden `"Loading templates…"` text for screen readers.

### Error

- Shown when the fetch fails (network error, non-2xx response).
- Uses the shared `<ErrorState>` component: title "Failed to load templates", the error message, and a "Try Again" button.
- Retry re-issues the same request with the current filters.
- Special case: HTTP 429 surfaces "Too many requests. Please try again in a moment."

### No Results (filtered)

- Shown when filters are active but the API returns an empty array.
- Uses `<EmptyState>` with icon `🔍`, title "No templates found", description "Try adjusting your search or filters…", and a "Clear Filters" action button.

### No Results (unfiltered)

- Shown when no filters are active and the API returns an empty array.
- Uses `<EmptyState>` with icon `📋`, title "No templates available", description "Templates will appear here once they are published." No action button.

### Results count

- When filters are active and results exist, a live region (`aria-live="polite"`) above the grid reads "{N} template(s) found".

---

## Mobile Behavior

| Breakpoint | Behavior |
|---|---|
| `< sm` (< 640 px) | Search input is full-width; category chips wrap to a second row; grid is 1 column |
| `sm – md` (640–1024 px) | Search and chips sit on one row (`flex-row`); grid is 2 columns |
| `≥ lg` (≥ 1024 px) | Full layout; grid is 3 columns |

The filter bar uses `flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between` so it reflows naturally. Category chips use `flex flex-wrap gap-2` to prevent overflow on narrow screens.

---

## Category Discovery

- All four categories are always visible as chips — no hidden dropdowns.
- The **All** chip is selected by default, showing the full catalog.
- Selecting a category immediately filters the grid (no submit step).
- The active category is reflected in the URL and the chip's `aria-pressed` state.
- Category labels and emoji icons are defined in `CATEGORY_LABELS` / `CATEGORY_ICONS` maps inside `TemplateCard.tsx` and `TemplateCatalogFilters.tsx`.

### Categories

| Value | Label | Icon | Use case |
|---|---|---|---|
| `dex` | DEX | 📊 | Decentralized exchange for trading Stellar assets |
| `lending` | Lending | 🏦 | Lending / borrowing protocols |
| `payment` | Payment | 💳 | Payment gateway and invoice management |
| `asset-issuance` | Asset Issuance | 🪙 | Custom Stellar asset creation and distribution |

---

## Accessibility

- Filter group: `role="group" aria-label="Filter by category"`.
- Category chips: `aria-pressed` boolean reflects selection state.
- Search: `type="search"`, `aria-label="Search templates"`.
- Loading skeleton: `role="status"` with visually-hidden label.
- Results count: `aria-live="polite"` region.
- Card CTA: `aria-label="Use {template.name} template"` for unique button labels.
- Preview images: `alt="{name} preview"`; emoji fallback is `aria-hidden="true"`.

---

## Implementation Reference

| File | Purpose |
|---|---|
| `apps/frontend/src/app/app/templates/page.tsx` | Page — wires filters, URL sync, and routing |
| `apps/frontend/src/components/app/templates/TemplateCatalogFilters.tsx` | Search input + category chips |
| `apps/frontend/src/components/app/templates/TemplateGrid.tsx` | Grid, loading skeleton, error, and empty states |
| `apps/frontend/src/components/app/templates/TemplateCard.tsx` | Individual template card |
| `apps/frontend/src/components/app/templates/useTemplates.ts` | Data-fetching hook with filter state and URL helpers |
| `packages/types/src/template.ts` | `Template`, `TemplateCategory`, `TemplateFilters` types |

---

## Edge Cases & Assumptions

- **Slow network**: the loading skeleton prevents layout shift; the abort controller cancels in-flight requests when filters change rapidly.
- **No preview image**: the category emoji is shown as a fallback — no broken-image state.
- **Long template names**: the card title does not clamp; descriptions clamp at 2 lines.
- **Single result**: the results count reads "1 template found" (singular).
- **Sort**: not implemented; order is determined server-side. A future sort control (e.g. "Newest", "Most deployed") can be added to the filter bar without breaking the existing layout.
- **Pagination**: not implemented in the current UI; the API supports `limit`/`offset` for future use.
