# Template Version Migration Procedures

This document outlines the standard procedures for migrating existing deployments to new template versions within the CRAFT platform.

## Overview

Template version migrations ensure that existing deployments can benefit from new features, security updates, and performance improvements without breaking their current functionality or losing customization data.

## Migration Workflow

### 1. Preparation and Snapshotting
Before initiating a migration, the system must take a snapshot of the current deployment state:
- Capture the current `customization_config`.
- Record the current `repository_url` and commit hash.
- Store the current Vercel deployment ID.

### 2. Compatibility Validation
The `TemplateMigrationService` verifies if the current configuration is compatible with the target template version.
- Check for required fields in the new version.
- Validate that all enabled features in the old version are still supported or mapped correctly.

### 3. Schema Migration (If Applicable)
If the new template version requires changes to the database schema (e.g., Supabase tables), these migrations are applied first.
- Migrations must be idempotent.
- Rollback scripts must be available.

### 4. Code Regeneration
The `TemplateGeneratorService` regenerates the workspace code using:
- The new template version as the base.
- The preserved `customization_config` from the snapshot.

### 5. Repository Update
The regenerated code is pushed to the user's repository:
- Use a new branch (e.g., `upgrade/v2.0.0`) for safety.
- Perform a dry run or automated testing if possible.

### 6. Deployment and Health Check
The platform triggers a redeployment (e.g., on Vercel):
- Monitor deployment logs for errors.
- Verify the new deployment URL returns a 200 OK status.

### 7. Finalization and Notification
Once the health check passes:
- Update the deployment record with the new template version.
- Send a notification to the user about the successful upgrade.

## Rollback Procedures

If any step in the migration workflow fails:
1. **Repository Rollback**: Revert the repository to the previous known good commit hash.
2. **State Restoration**: Restore the deployment record in Supabase using the snapshot taken in Step 1.
3. **Notification**: Inform the user of the failed migration and the reason for the rollback.

## Best Practices

- **Test with Real Data**: Always test migrations using a copy of real deployment data.
- **Backward Compatibility**: New template versions should aim to be backward compatible with previous configurations.
- **Minimal Downtime**: Aim for zero-downtime migrations by leveraging Vercel's deployment previews.
