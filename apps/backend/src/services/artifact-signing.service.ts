/**
 * ArtifactSigningService
 *
 * Signs and verifies deployment artifacts using SHA-256 + HMAC-SHA256.
 * The signing secret is read from process.env.ARTIFACT_SIGNING_SECRET.
 *
 * Key Rotation Procedure:
 *   1. Before rotating, add the current (soon-to-be-old) secret to
 *      ARTIFACT_SIGNING_SECRET_PREVIOUS (comma-separated list).
 *   2. Update ARTIFACT_SIGNING_SECRET to the new primary secret.
 *   3. verifyArtifact will now accept signatures made with either the new
 *      primary secret or any of the previous secrets, providing a grace window.
 *   4. Once all in-flight artifacts have been re-signed (or expired), remove
 *      the old secret from ARTIFACT_SIGNING_SECRET_PREVIOUS.
 *
 * Issue: #919
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { posix as path } from 'path';

export class ArtifactSigningService {
    private get secret(): string {
        const s = process.env.ARTIFACT_SIGNING_SECRET;
        if (!s) throw new Error('ARTIFACT_SIGNING_SECRET environment variable is not set');
        return s;
    }

    /**
     * Returns the list of previous (rotated-out) signing secrets parsed from
     * the comma-separated ARTIFACT_SIGNING_SECRET_PREVIOUS environment variable.
     * Returns an empty array when the variable is unset or blank.
     */
    private get previousSecrets(): string[] {
        const raw = process.env.ARTIFACT_SIGNING_SECRET_PREVIOUS;
        if (!raw) return [];
        return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }

    signArtifact(artifact: Buffer | string): { checksum: string; signature: string } {
        const buf = Buffer.isBuffer(artifact) ? artifact : Buffer.from(artifact, 'utf8');
        const checksum = 'sha256:' + createHash('sha256').update(buf).digest('hex');
        const signature = createHmac('sha256', this.secret).update(checksum).digest('hex');
        return { checksum, signature };
    }

    /**
     * Validate a storage path against per-user namespace requirements.
     *
     * The path must start with `{userId}/` after normalization. This prevents
     * path traversal attacks (e.g. `../../other-user/deploy/artifact.zip`)
     * where a malicious user could read or overwrite another user's artifacts.
     *
     * Normalization resolves `.` and `..` segments, so a path like
     * `user-1/../../other-user/deploy/artifact.zip` becomes
     * `other-user/deploy/artifact.zip` and is rejected because the first
     * component does not match `userId`.
     *
     * @param userId  The authenticated user's ID.
     * @param storagePath  The proposed storage path (e.g. `user-1/deploy-abc/artifact.zip`).
     * @returns `true` if the path is valid for this user, `false` otherwise.
     */
    validateStoragePath(userId: string, storagePath: string): boolean {
        if (!userId || !storagePath) return false;

        const normalized = path.normalize(storagePath);
        const expectedPrefix = userId + '/';

        return normalized.startsWith(expectedPrefix);
    }

    verifyArtifact(artifact: Buffer | string, checksum: string, signature: string): boolean {
        try {
            const buf = Buffer.isBuffer(artifact) ? artifact : Buffer.from(artifact, 'utf8');
            const expectedChecksum = 'sha256:' + createHash('sha256').update(buf).digest('hex');

            const checksumMatch = timingSafeEqual(
                Buffer.from(checksum),
                Buffer.from(expectedChecksum),
            );
            if (!checksumMatch) return false;

            // Try primary secret first, then fall back to each previous secret
            // in order. timingSafeEqual is used for every comparison to prevent
            // timing-based side-channel attacks.
            const candidates = [this.secret, ...this.previousSecrets];
            for (const candidateSecret of candidates) {
                const expectedSignature = createHmac('sha256', candidateSecret)
                    .update(expectedChecksum)
                    .digest('hex');
                const signatureMatch = timingSafeEqual(
                    Buffer.from(signature),
                    Buffer.from(expectedSignature),
                );
                if (signatureMatch) return true;
            }
            return false;
        } catch {
            return false;
        }
    }
}

export const artifactSigningService = new ArtifactSigningService();
