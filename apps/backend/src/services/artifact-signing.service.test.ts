import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArtifactSigningService, artifactSigningService } from './artifact-signing.service';

describe('ArtifactSigningService', () => {
    const PRIMARY_SECRET = 'primary-secret-key-1234567890';
    const OLD_SECRET_1 = 'old-secret-key-alpha-987654321';
    const OLD_SECRET_2 = 'old-secret-key-beta-1122334455';
    let service: ArtifactSigningService;
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        process.env.ARTIFACT_SIGNING_SECRET = PRIMARY_SECRET;
        delete process.env.ARTIFACT_SIGNING_SECRET_PREVIOUS;
        service = new ArtifactSigningService();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('signArtifact()', () => {
        it('signs a Buffer payload and returns valid checksum and HMAC signature', () => {
            const payload = Buffer.from('console.log("hello world");', 'utf8');
            const result = service.signArtifact(payload);

            expect(result.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
            expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
        });

        it('signs a string payload and returns consistent result with Buffer input', () => {
            const strPayload = 'export const config = { enabled: true };';
            const bufPayload = Buffer.from(strPayload, 'utf8');

            const resultFromStr = service.signArtifact(strPayload);
            const resultFromBuf = service.signArtifact(bufPayload);

            expect(resultFromStr.checksum).toBe(resultFromBuf.checksum);
            expect(resultFromStr.signature).toBe(resultFromBuf.signature);
        });

        it('produces deterministic output for identical input', () => {
            const payload = 'consistent-build-artifact-content';
            const sign1 = service.signArtifact(payload);
            const sign2 = service.signArtifact(payload);

            expect(sign1.checksum).toBe(sign2.checksum);
            expect(sign1.signature).toBe(sign2.signature);
        });

        it('produces distinct checksums and signatures for different payloads', () => {
            const sign1 = service.signArtifact('artifact-v1');
            const sign2 = service.signArtifact('artifact-v2');

            expect(sign1.checksum).not.toBe(sign2.checksum);
            expect(sign1.signature).not.toBe(sign2.signature);
        });

        it('throws an error if ARTIFACT_SIGNING_SECRET is not configured', () => {
            delete process.env.ARTIFACT_SIGNING_SECRET;

            expect(() => service.signArtifact('test-payload')).toThrow(
                'ARTIFACT_SIGNING_SECRET environment variable is not set'
            );
        });
    });

    describe('verifyArtifact() - Happy Path', () => {
        it('verifies a valid artifact buffer against its signed checksum and signature', () => {
            const payload = Buffer.from('valid-production-build-data');
            const { checksum, signature } = service.signArtifact(payload);

            const isValid = service.verifyArtifact(payload, checksum, signature);
            expect(isValid).toBe(true);
        });

        it('verifies a valid artifact string against its signed checksum and signature', () => {
            const payload = 'valid-production-build-string';
            const { checksum, signature } = service.signArtifact(payload);

            const isValid = service.verifyArtifact(payload, checksum, signature);
            expect(isValid).toBe(true);
        });
    });

    describe('verifyArtifact() - Tampered and Mismatched Payloads (Fail Closed)', () => {
        it('fails verification when payload is modified (tampered byte)', () => {
            const originalPayload = Buffer.from('original-unaltered-code');
            const { checksum, signature } = service.signArtifact(originalPayload);

            const tamperedPayload = Buffer.from('original-altered--code');

            const isValid = service.verifyArtifact(tamperedPayload, checksum, signature);
            expect(isValid).toBe(false);
        });

        it('fails verification when payload has appended content', () => {
            const originalPayload = 'clean code';
            const { checksum, signature } = service.signArtifact(originalPayload);

            const tamperedPayload = 'clean code; maliciousCode();';

            const isValid = service.verifyArtifact(tamperedPayload, checksum, signature);
            expect(isValid).toBe(false);
        });

        it('fails verification when checksum does not match payload', () => {
            const payload = 'sample code';
            const { signature } = service.signArtifact(payload);
            const incorrectChecksum = 'sha256:' + '0'.repeat(64);

            const isValid = service.verifyArtifact(payload, incorrectChecksum, signature);
            expect(isValid).toBe(false);
        });

        it('fails verification when signature does not match checksum', () => {
            const payload = 'sample code';
            const { checksum } = service.signArtifact(payload);
            const incorrectSignature = 'f'.repeat(64);

            const isValid = service.verifyArtifact(payload, checksum, incorrectSignature);
            expect(isValid).toBe(false);
        });
    });

    describe('verifyArtifact() - Malformed Inputs (Fail Closed without crashing)', () => {
        it('returns false when signature is an empty string or malformed length', () => {
            const payload = 'sample code';
            const { checksum } = service.signArtifact(payload);

            expect(service.verifyArtifact(payload, checksum, '')).toBe(false);
            expect(service.verifyArtifact(payload, checksum, 'short-sig')).toBe(false);
            expect(service.verifyArtifact(payload, checksum, '12345')).toBe(false);
        });

        it('returns false when checksum is malformed or invalid format', () => {
            const payload = 'sample code';
            const { signature } = service.signArtifact(payload);

            expect(service.verifyArtifact(payload, '', signature)).toBe(false);
            expect(service.verifyArtifact(payload, 'not-a-valid-checksum', signature)).toBe(false);
            expect(service.verifyArtifact(payload, 'md5:1234', signature)).toBe(false);
        });

        it('returns false when ARTIFACT_SIGNING_SECRET is unset during verification', () => {
            const payload = 'sample code';
            const { checksum, signature } = service.signArtifact(payload);

            delete process.env.ARTIFACT_SIGNING_SECRET;

            const isValid = service.verifyArtifact(payload, checksum, signature);
            expect(isValid).toBe(false);
        });
    });

    describe('verifyArtifact() - Key Rotation Support', () => {
        it('verifies signatures generated with previous secrets listed in ARTIFACT_SIGNING_SECRET_PREVIOUS', () => {
            // Sign with OLD_SECRET_1
            process.env.ARTIFACT_SIGNING_SECRET = OLD_SECRET_1;
            const oldService = new ArtifactSigningService();
            const payload = 'legacy-build-artifact';
            const { checksum, signature } = oldService.signArtifact(payload);

            // Now rotate to PRIMARY_SECRET, keeping OLD_SECRET_1 in previous secrets
            process.env.ARTIFACT_SIGNING_SECRET = PRIMARY_SECRET;
            process.env.ARTIFACT_SIGNING_SECRET_PREVIOUS = `${OLD_SECRET_1}, ${OLD_SECRET_2}`;
            const rotatedService = new ArtifactSigningService();

            const isValid = rotatedService.verifyArtifact(payload, checksum, signature);
            expect(isValid).toBe(true);
        });

        it('verifies signatures generated with second rotated secret in list', () => {
            // Sign with OLD_SECRET_2
            process.env.ARTIFACT_SIGNING_SECRET = OLD_SECRET_2;
            const oldService = new ArtifactSigningService();
            const payload = 'legacy-build-artifact-2';
            const { checksum, signature } = oldService.signArtifact(payload);

            // Now verify with rotated primary and multiple previous secrets
            process.env.ARTIFACT_SIGNING_SECRET = PRIMARY_SECRET;
            process.env.ARTIFACT_SIGNING_SECRET_PREVIOUS = `${OLD_SECRET_1}, ${OLD_SECRET_2}`;
            const rotatedService = new ArtifactSigningService();

            const isValid = rotatedService.verifyArtifact(payload, checksum, signature);
            expect(isValid).toBe(true);
        });

        it('fails verification if artifact was signed with an old secret not present in ARTIFACT_SIGNING_SECRET_PREVIOUS', () => {
            // Sign with an unlisted old secret
            process.env.ARTIFACT_SIGNING_SECRET = 'unlisted-retired-secret';
            const oldService = new ArtifactSigningService();
            const payload = 'retired-build-artifact';
            const { checksum, signature } = oldService.signArtifact(payload);

            // Rotate without adding the unlisted secret
            process.env.ARTIFACT_SIGNING_SECRET = PRIMARY_SECRET;
            process.env.ARTIFACT_SIGNING_SECRET_PREVIOUS = `${OLD_SECRET_1}`;
            const rotatedService = new ArtifactSigningService();

            const isValid = rotatedService.verifyArtifact(payload, checksum, signature);
            expect(isValid).toBe(false);
        });
    });

    describe('validateStoragePath()', () => {
        it('returns true for valid per-user storage paths', () => {
            expect(service.validateStoragePath('user_123', 'user_123/deployments/dep_1/bundle.zip')).toBe(true);
            expect(service.validateStoragePath('org_abc', 'org_abc/artifact.tar.gz')).toBe(true);
        });

        it('returns false for path traversal attempts escaping user namespace', () => {
            expect(
                service.validateStoragePath('user_123', 'user_123/../../other_user/deployments/bundle.zip')
            ).toBe(false);
            expect(
                service.validateStoragePath('user_123', '../user_123/bundle.zip')
            ).toBe(false);
            expect(
                service.validateStoragePath('user_123', 'user_123/sub/../../..')
            ).toBe(false);
        });

        it('returns false when storagePath starts with a different user prefix', () => {
            expect(
                service.validateStoragePath('user_123', 'user_456/deployments/bundle.zip')
            ).toBe(false);
            expect(
                service.validateStoragePath('user_123', 'user_123_extra/bundle.zip')
            ).toBe(false);
        });

        it('returns false when userId or storagePath is empty', () => {
            expect(service.validateStoragePath('', 'user_123/bundle.zip')).toBe(false);
            expect(service.validateStoragePath('user_123', '')).toBe(false);
            expect(service.validateStoragePath('', '')).toBe(false);
        });
    });

    describe('Singleton export', () => {
        it('exports a default singleton instance of ArtifactSigningService', () => {
            expect(artifactSigningService).toBeInstanceOf(ArtifactSigningService);
        });
    });
});
