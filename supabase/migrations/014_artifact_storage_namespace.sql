-- Migration 014: Artifact Storage Namespace Isolation
--
-- Creates the "deployment_artifacts" bucket with per-user namespace prefixing.
--
-- Path-based namespacing scheme:
--   Artifacts are stored at: {user_id}/{deployment_id}/artifact.zip
--   Only users can read/write their own {user_id} namespace.
--   Cross-user access is denied by RLS policies.
--
-- Access rules:
--   - INSERT: User can upload only to paths starting with their own user_id
--   - SELECT: User can read only from paths starting with their own user_id
--   - UPDATE/DELETE: Not allowed via policy
--
-- Server-side path validation is enforced in artifact-signing.service.ts
-- BEFORE each storage write, providing defense-in-depth security.
--
-- Issue: #XXX — Artifact Storage Namespace Isolation

INSERT INTO storage.buckets (id, name, public)
VALUES ('deployment_artifacts', 'deployment_artifacts', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allow authenticated users to upload artifacts to their own namespace
CREATE POLICY "Users can upload to own artifact namespace"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'deployment_artifacts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Allow authenticated users to read artifacts from their own namespace
CREATE POLICY "Users can read own artifacts"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'deployment_artifacts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Deny all cross-user artifact access
CREATE POLICY "Deny cross-user artifact access"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'deployment_artifacts'
    AND (storage.foldername(name))[1] != auth.uid()::text
  )
  WITH CHECK (false);
