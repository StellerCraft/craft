# GitHub → Vercel Deployment Triggering

This document describes the secure GitHub webhook-based deployment triggering system that automatically deploys to Vercel when code is pushed to a configured branch.

## Overview

The system uses GitHub webhooks to trigger Vercel deployments via the backend API. Every push to the configured branch automatically triggers a Vercel deployment, and deployment metadata (IDs, status, commit reference) is tracked and returned for observability.

## Architecture

```
GitHub Push Event
    ↓
GitHub Webhook (signed with HMAC-SHA256)
    ↓
Backend API: POST /api/webhooks/github
    ↓
Signature Verification
    ↓
GitHub-to-Vercel Deployment Service
    ↓
Vercel API: Trigger Deployment
    ↓
Store Metadata in Supabase
    ↓
Return Deployment ID + URL
```

## Security

- **Webhook Signature Verification**: All incoming webhooks are verified using HMAC-SHA256 with timing-safe comparison
- **Secret Protection**: `GITHUB_WEBHOOK_SECRET` is stored in environment variables and never exposed to frontend
- **Token Security**: `VERCEL_TOKEN` is used server-side only and never exposed to frontend
- **Authenticated Endpoints**: Deployment tracking endpoints require authentication via Supabase session
- **Rate Limiting**: Existing rate limiting middleware applies to all API endpoints

## Required Environment Variables

Add the following to your `.env` file:

```bash
# GitHub Webhook Secret (generate in GitHub repository settings)
GITHUB_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx

# Vercel Project ID (from Vercel project settings)
VERCEL_PROJECT_ID=prj_xxxxxxxxxxxxx

# Vercel API Token (from Vercel account settings)
VERCEL_TOKEN=xxxxxxxxxxxxx

# Vercel Team ID (optional, for team projects)
VERCEL_TEAM_ID=team_xxxxxxxxxxxxx

# GitHub Deployment Branch (default: main)
GITHUB_DEPLOYMENT_BRANCH=main
```

## Setup Instructions

### 1. Generate GitHub Webhook Secret

In your GitHub repository:
- Go to Settings → Webhooks → Add webhook
- Set Payload URL to: `https://your-domain.com/api/webhooks/github`
- Set Content type to: `application/json`
- Secret: Generate a random string (e.g., `openssl rand -hex 32`)
- Select events: "Push" events
- Click "Add webhook"

Copy the generated secret to your `.env` file as `GITHUB_WEBHOOK_SECRET`.

### 2. Get Vercel Project ID

In your Vercel project:
- Go to Project Settings → General
- Copy the Project ID (format: `prj_xxxxxxxxxxxxx`)
- Add to your `.env` file as `VERCEL_PROJECT_ID`

### 3. Get Vercel API Token

In your Vercel account:
- Go to Settings → Tokens
- Create a new token with "Full Access" scope
- Copy the token to your `.env` file as `VERCEL_TOKEN`

### 4. Configure Deployment Branch (Optional)

By default, deployments trigger on pushes to `main`. To change this:

```bash
GITHUB_DEPLOYMENT_BRANCH=production
```

### 5. Run Database Migration

Apply the database schema migration to create the deployment tracking table:

```bash
# Apply the migration
supabase migration up
```

This creates the `github_vercel_deployments` table with the following schema:

```sql
CREATE TABLE github_vercel_deployments (
    id UUID PRIMARY KEY,
    repo_full_name TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    branch TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    commit_message TEXT,
    pusher_name TEXT,
    vercel_deployment_id TEXT NOT NULL UNIQUE,
    vercel_deployment_url TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
```

## API Endpoints

### POST /api/webhooks/github

Receives GitHub webhook events and triggers Vercel deployments.

**Headers:**
- `x-hub-signature-256`: HMAC-SHA256 signature of the payload
- `x-github-event`: Event type (push, ping, etc.)
- `x-github-delivery`: Unique delivery ID (for replay protection)

**Request Body:**
GitHub webhook payload (JSON)

**Response:**
```json
{
  "received": true,
  "processed": true
}
```

**Status Codes:**
- `200`: Webhook processed successfully
- `400`: Invalid request (missing headers, invalid JSON)
- `401`: Invalid signature
- `500`: Server error (missing secrets, deployment trigger failed)

### GET /api/deployments/github

Retrieves recent GitHub-triggered Vercel deployments. Requires authentication.

**Query Parameters:**
- `repoFullName`: GitHub repository full name (e.g., "owner/repo")
- `limit`: Maximum number of deployments to return (default: 10)

**Response:**
```json
{
  "deployments": [
    {
      "id": "uuid",
      "repoFullName": "owner/repo",
      "repoName": "repo",
      "branch": "main",
      "commitSha": "abc123def456",
      "commitMessage": "Fix bug",
      "pusherName": "user",
      "vercelDeploymentId": "dpl_xxxxxxxxxxxxx",
      "vercelDeploymentUrl": "https://project.vercel.app",
      "status": "ready",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:05:00Z"
    }
  ]
}
```

## Deployment Status

The system tracks the following deployment statuses:

- `queued`: Deployment queued in Vercel
- `building`: Deployment is building
- `ready`: Deployment succeeded and is live
- `error`: Deployment encountered an error
- `failed`: Deployment failed
- `canceled`: Deployment was canceled

## Status Sync

Deployment status is synced from Vercel API via the `syncDeploymentStatus` method in the `GitHubToVercelDeploymentService`. This can be called manually or via a scheduled job to keep the database in sync with Vercel's actual deployment status.

To sync a deployment:

```typescript
import { githubToVercelDeploymentService } from '@/services/github-to-vercel-deployment.service';

const metadata = await githubToVercelDeploymentService.syncDeploymentStatus('dpl_xxxxxxxxxxxxx');
```

## Testing

### Unit Tests

Run unit tests for webhook verification:

```bash
cd apps/backend
npm test -- github-to-vercel-deployment.service.test.ts
npm test -- webhook-verification.test.ts
```

### Integration Tests

Run integration tests for the webhook endpoint:

```bash
cd apps/backend
npm test -- app/api/webhooks/github/route.test.ts
```

### Manual Testing

To test the webhook manually:

1. Create a test payload:
```bash
cat > payload.json << EOF
{
  "ref": "refs/heads/main",
  "repository": {
    "full_name": "owner/repo",
    "name": "repo"
  },
  "head_commit": {
    "id": "abc123def456",
    "message": "Test commit"
  },
  "pusher": {
    "name": "testuser"
  }
}
EOF
```

2. Generate signature:
```bash
import { generateGitHubWebhookSignature } from '@/lib/github/webhook-verification';
const signature = generateGitHubWebhookSignature(
  JSON.stringify(payload),
  process.env.GITHUB_WEBHOOK_SECRET
);
```

3. Send request:
```bash
curl -X POST http://localhost:4001/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: $signature" \
  -H "x-github-event: push" \
  -d @payload.json
```

## Debugging Failed Deployments

### Check Webhook Delivery

1. In GitHub repository: Settings → Webhooks
2. Click on the webhook to see recent deliveries
3. Check response status code and body

### Check Backend Logs

The system uses structured logging with correlation IDs. Check logs for:

- `Webhook signature verified` - Signature validation passed
- `Triggering Vercel deployment` - Deployment trigger initiated
- `Vercel deployment triggered successfully` - Vercel API responded successfully
- `Failed to trigger Vercel deployment` - Vercel API error

### Check Vercel Dashboard

1. Go to Vercel project dashboard
2. Check Deployments tab
3. Find deployment by commit SHA or deployment ID
4. View build logs for error details

### Check Database

Query the deployment table directly:

```sql
SELECT * FROM github_vercel_deployments
ORDER BY created_at DESC
LIMIT 10;
```

## Tracing Deployment IDs

Each deployment has a unique ID stored in the database. To trace a deployment:

1. Get the Vercel deployment ID from the webhook payload or API response
2. Query the database:
```sql
SELECT * FROM github_vercel_deployments
WHERE vercel_deployment_id = 'dpl_xxxxxxxxxxxxx';
```
3. Use the Vercel deployment ID to view details in the Vercel dashboard

## Example Deployment Response

When a deployment is successfully triggered:

```json
{
  "success": true,
  "deploymentId": "uuid-from-database",
  "deploymentUrl": "https://project.vercel.app",
  "status": "QUEUED"
}
```

The database record contains:

```json
{
  "id": "uuid-from-database",
  "repoFullName": "owner/repo",
  "repoName": "repo",
  "branch": "main",
  "commitSha": "abc123def456",
  "commitMessage": "Fix bug",
  "pusherName": "developer",
  "vercelDeploymentId": "dpl_xxxxxxxxxxxxx",
  "vercelDeploymentUrl": "https://project.vercel.app",
  "status": "queued",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

## Edge Cases Handled

- **Invalid webhook signature**: Returns 401, logs warning
- **Missing webhook secret**: Returns 500, logs error
- **Missing VERCEL_PROJECT_ID**: Returns error, logs error
- **Vercel API failure**: Returns error, logs error, deployment record not created
- **Database insertion failure**: Deployment still triggered, error logged
- **Push to non-configured branch**: Deployment not triggered, logged
- **Unsupported event types**: Acknowledged with 200, not processed
- **Duplicate webhook delivery**: Handled by GitHub's retry mechanism
- **Malformed JSON**: Returns 400, logs error

## Idempotency

The system is idempotent:
- Duplicate webhook deliveries with the same `x-github-delivery` ID are acknowledged without reprocessing
- Multiple pushes to the same commit create separate deployment records
- Vercel API is called for each push event

## Rate Limiting

The system respects existing rate limiting middleware:
- Webhook endpoint is rate-limited per IP
- Deployment tracking endpoint is rate-limited per authenticated user
- Vercel API has its own rate limits (handled by Vercel service)

## Monitoring

Monitor the following metrics:

- Webhook success rate (200 responses vs errors)
- Deployment trigger success rate
- Average deployment time (queued → ready)
- Failed deployment rate
- Database insertion success rate

Logs are structured JSON and can be shipped to your log aggregation service.

## Troubleshooting

### Webhook not triggering deployments

1. Verify webhook secret matches between GitHub and `.env`
2. Check webhook is receiving events in GitHub webhook delivery log
3. Check backend logs for signature verification errors
4. Verify `VERCEL_PROJECT_ID` is set correctly

### Deployment stuck in "queued" status

1. Check Vercel dashboard for deployment status
2. Verify Vercel project has proper build configuration
3. Check Vercel build logs for errors
4. Manually sync status using `syncDeploymentStatus`

### Database insertion failing

1. Verify migration has been applied
2. Check database connection
3. Verify Supabase RLS policies allow service role writes
4. Check database logs for constraint violations

## Related Files

- `apps/backend/src/app/api/webhooks/github/route.ts` - Webhook endpoint
- `apps/backend/src/lib/github/webhook-verification.ts` - Signature verification
- `apps/backend/src/services/github-to-vercel-deployment.service.ts` - Deployment service
- `apps/backend/src/services/vercel.service.ts` - Vercel API client
- `supabase/migrations/008_github_vercel_deployments.sql` - Database schema
