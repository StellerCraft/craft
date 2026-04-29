/**
 * ArtifactSigningService
 *
 * Signs and verifies deployment artifacts using SHA-256 + HMAC-SHA256.
 * The signing secret is read from process.env.ARTIFACT_SIGNING_SECRET.
 *
 * Issue: #496
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';

export class ArtifactSigningService {
    private get secret(): string {
        const s = process.env.ARTIFACT_SIGNING_SECRET;
        if (!s) throw new Error('ARTIFACT_SIGNING_SECRET environment variable is not set');
        return s;
    }

    signArtifact(artifact: Buffer | string): { checksum: string; signature: string } {
        const buf = Buffer.isBuffer(artifact) ? artifact : Buffer.from(artifact, 'utf8');
        const checksum = 'sha256:' + createHash('sha256').update(buf).digest('hex');
        const signature = createHmac('sha256', this.secret).update(checksum).digest('hex');
        return { checksum, signature };
    }

    verifyArtifact(artifact: Buffer | string, checksum: string, signature: string): boolean {
        try {
            const buf = Buffer.isBuffer(artifact) ? artifact : Buffer.from(artifact, 'utf8');
            const expectedChecksum = 'sha256:' + createHash('sha256').update(buf).digest('hex');
            const expectedSignature = createHmac('sha256', this.secret).update(expectedChecksum).digest('hex');

            const checksumMatch = timingSafeEqual(
                Buffer.from(checksum),
                Buffer.from(expectedChecksum),
            );
            const signatureMatch = timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature),
            );
            return checksumMatch && signatureMatch;
        } catch {
            return false;
        }
    }
}

export const artifactSigningService = new ArtifactSigningService();
