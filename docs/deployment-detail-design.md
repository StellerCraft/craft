# Deployment Detail — Design Document

**Issue:** #024  
**Route:** `/app/deployments/[id]`  
**Page file:** `apps/frontend/src/app/app/deployments/[id]/page.tsx`

---

## Overview

The deployment detail page gives users a single-pane view of everything relevant to one deployment: its current state, build output, runtime health, analytics, and the history of prior deployments for the same project. It also surfaces the two primary destructive actions — redeploy and delete — with appropriate confirmation guards.

---

## Page Sections

### 1. Header

Displays the deployment name and current `DeploymentStatusBadge` side-by-side. The name comes from `GET /api/deployments/[id]` → `name`.

### 2. Actions Toolbar

| Action | Condition | API call |
|--------|-----------|----------|
| **Visit** | `url` present | Opens `deployment.url` in new tab |
| **Redeploy** | `status` is `success`, `failed`, or `cancelled` | `POST /api/deployments/[id]/redeploy` (future) |
| **Delete** | Always visible | `DELETE /api/deployments/[id]` — two-step confirmation inline |

Delete uses an inline confirm pattern (no modal) to keep the interaction lightweight. The confirm state is local React state; on confirmation the page redirects to `/app/deployments`.

### 3. Metadata

Tabular key/value layout. Fields:

| Field | Source |
|-------|--------|
| Environment | `deployment.environment` |
| Trigger | `deployment.trigger` |
| Commit SHA + message | `deployment.commit` |
| Branch | `deployment.commit.branch` |
| Author | `deployment.commit.author` |
| Region | `deployment.region` |
| Started | `deployment.createdAt` (relative) |
| Duration | `deployment.durationSeconds` (formatted) |
| URL | `deployment.url` (link) |
| Repository | `deployment.repositoryUrl` (link) |

### 4. Health

Source: `GET /api/deployments/[id]/health`

Displays: healthy/unhealthy indicator, HTTP status code, response time (ms), last-checked timestamp. Refreshes on a 5-minute interval (Vercel Cron drives the backend check; the UI polls or uses SWR revalidation).

### 5. Analytics

Source: `GET /api/deployments/[id]/analytics` → `summary`

Displays three headline metrics: total page views, uptime percentage, total transactions. A "Export CSV" link points to `GET /api/deployments/[id]/analytics/export`.

### 6. Logs

Source: `GET /api/deployments/[id]/logs?order=asc&limit=200`

- Rendered in a fixed-height scrollable dark terminal pane.
- Client-side level filter (`all` / `info` / `warn` / `error`) — no extra API call.
- Each row: `HH:MM:SS  LEVEL  message`.
- `role="log"` + `aria-live="polite"` for screen-reader compatibility.
- Pagination: "Load more" button appends the next page (`?page=2`).

### 7. History

Source: `GET /api/deployments?name=[deployment.name]&limit=10` (same project, ordered by `createdAt desc`)

Lists prior deployments for the same project name. The current deployment is highlighted. Each row links to its own detail page (`/app/deployments/[id]`), enabling diff navigation between versions.

---

## Action Affordances

### Redeploy

- **Trigger:** User clicks "Redeploy" in the actions toolbar.
- **Precondition:** `status` ∈ `{success, failed, cancelled}`.
- **Effect:** Creates a new deployment record with the same `templateId` and `customizationConfig`. The new deployment appears at the top of the history list.
- **API:** `POST /api/deployments/[id]/redeploy` (to be implemented; see issue #025).
- **UI feedback:** Button shows spinner while in-flight; on success, redirect to the new deployment's detail page.

### Delete

- **Trigger:** User clicks "Delete", then confirms inline.
- **Effect:** Calls `DELETE /api/deployments/[id]`, which removes the GitHub repo, Vercel project, and DB record (cascade to logs and analytics).
- **UI feedback:** Two-step inline confirm (no modal). On success, redirect to `/app/deployments`.
- **Edge case:** If the deployment is `running`, the delete button is still shown but the API will reject it with a 409 until the build completes. The UI should surface this error inline.

---

## Customization Updates and History Diffs

Customization changes are applied via `PATCH /api/deployments/[id]` (updating `customization_config`), which triggers a new deployment pipeline run. The resulting new deployment record appears in the history list.

To surface diffs between versions:
- The history list links each entry to its own detail page.
- The metadata section shows the commit SHA and message for each version.
- A future "Compare" affordance (issue #026) will render a side-by-side diff of `customization_config` between two history entries.

---

## Data Contracts

```typescript
// GET /api/deployments/[id]
{
  id: string;
  name: string;
  status: DeploymentStatusType;
  templateId: string;
  vercelProjectId?: string;
  deploymentUrl?: string;
  repositoryUrl?: string;
  customizationConfig: CustomizationConfig;
  errorMessage?: string;
  timestamps: { created: string; updated: string; deployed?: string };
}

// GET /api/deployments/[id]/health
{
  isHealthy: boolean;
  responseTime: number;   // ms
  statusCode: number;
  error: string | null;
  lastChecked: string;    // ISO 8601
}

// GET /api/deployments/[id]/analytics
{
  analytics: Array<{ id, metricType, metricValue, recordedAt }>;
  summary: {
    totalPageViews: number;
    uptimePercentage: number;
    totalTransactions: number;
    lastChecked: string;
  };
}

// GET /api/deployments/[id]/logs
{
  data: Array<{ id, deploymentId, timestamp, level, message }>;
  pagination: { page, limit, total, hasNextPage };
}
```

---

## Accessibility

- Each section uses `<section aria-label="…">` for landmark navigation.
- The log pane uses `role="log"` and `aria-live="polite"`.
- Action buttons have `aria-label` attributes that include the deployment name.
- The delete confirm flow is keyboard-navigable (no focus trap needed for inline confirm).

---

## Follow-up Work

| Issue | Description |
|-------|-------------|
| #025 | Implement `POST /api/deployments/[id]/redeploy` endpoint |
| #026 | Side-by-side customization diff between history entries |
| #027 | Replace mock fixtures with SWR data fetching hooks |
| #028 | Real-time log streaming via Supabase Realtime subscription |
