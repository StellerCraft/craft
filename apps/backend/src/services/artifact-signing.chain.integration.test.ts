/**
 * Integration test for ArtifactSigningService cryptographic verification chain
 *
 * Tests the full sign → store → retrieve → verify chain:
 *   - Sign an artifact bundle
 *   - Store signed artifact and signature in mocked storage
 *   - Retrieve and verify cryptographically
 *   - Test tampered artifact: verify fails with modified byte
 *
 * Issue: #819
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArtifactSigningService, artifactSigningService } from './artifact-signing.service';

interface MockStorageState {
  artifacts: Map<string, { data: Buffer; checksum: string; signature: string }>;
}

class MockSupabaseStorage {
  private state: MockStorageState;

  constructor(state: MockStorageState) {
    this.state = state;
  }

  async storeArtifact(
    key: string,
    data: Buffer,
    checksum: string,
    signature: string
  ): Promise<void> {
    this.state.artifacts.set(key, { data, checksum, signature });
  }

  async retrieveArtifact(key: string): Promise<{
    data: Buffer;
    checksum: string;
    signature: string;
  } | null> {
    return this.state.artifacts.get(key) || null;
  }
}

describe('ArtifactSigningService - Verification Chain Integration', () => {
  let mockStorage: MockSupabaseStorage;
  let storageState: MockStorageState;

  beforeEach(() => {
    storageState = { artifacts: new Map() };
    mockStorage = new MockSupabaseStorage(storageState);
    process.env.ARTIFACT_SIGNING_SECRET = 'test-secret-key-for-signing';
  });

  it('should sign artifact and verify signature matches', () => {
    const artifact = Buffer.from('test artifact payload');

    const { checksum, signature } = artifactSigningService.signArtifact(artifact);

    expect(checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);

    const isValid = artifactSigningService.verifyArtifact(
      artifact,
      checksum,
      signature
    );
    expect(isValid).toBe(true);
  });

  it('should complete sign → store → retrieve → verify chain', async () => {
    const artifactData = Buffer.from(
      JSON.stringify({ version: '1.0.0', files: ['index.js', 'package.json'] })
    );
    const artifactKey = 'deployment-abc123';

    // Stage 1: Sign
    const { checksum, signature } = artifactSigningService.signArtifact(
      artifactData
    );

    // Stage 2: Store
    await mockStorage.storeArtifact(
      artifactKey,
      artifactData,
      checksum,
      signature
    );

    // Stage 3: Retrieve
    const retrieved = await mockStorage.retrieveArtifact(artifactKey);
    expect(retrieved).not.toBeNull();

    // Stage 4: Verify
    const isValid = artifactSigningService.verifyArtifact(
      retrieved!.data,
      retrieved!.checksum,
      retrieved!.signature
    );
    expect(isValid).toBe(true);
  });

  it('should fail verification when artifact is tampered', async () => {
    const artifactData = Buffer.from(
      JSON.stringify({ deploymentId: 'dep-123', status: 'pending' })
    );
    const artifactKey = 'deployment-tampering-test';

    // Sign and store
    const { checksum, signature } = artifactSigningService.signArtifact(
      artifactData
    );
    await mockStorage.storeArtifact(
      artifactKey,
      artifactData,
      checksum,
      signature
    );

    // Retrieve
    const retrieved = await mockStorage.retrieveArtifact(artifactKey);
    expect(retrieved).not.toBeNull();

    // Tamper: modify one byte
    const tamperedData = Buffer.from(retrieved!.data);
    tamperedData[0] ^= 0xff; // Flip all bits in first byte

    // Verify should fail
    const isValid = artifactSigningService.verifyArtifact(
      tamperedData,
      retrieved!.checksum,
      retrieved!.signature
    );
    expect(isValid).toBe(false);
  });

  it('should fail verification with modified checksum', async () => {
    const artifactData = Buffer.from('test artifact');
    const artifactKey = 'deployment-checksum-tampering';

    // Sign and store
    const { checksum, signature } = artifactSigningService.signArtifact(
      artifactData
    );
    await mockStorage.storeArtifact(
      artifactKey,
      artifactData,
      checksum,
      signature
    );

    // Retrieve
    const retrieved = await mockStorage.retrieveArtifact(artifactKey);

    // Tamper with checksum
    const modifiedChecksum = 'sha256:' + 'a'.repeat(64);

    // Verify should fail
    const isValid = artifactSigningService.verifyArtifact(
      retrieved!.data,
      modifiedChecksum,
      retrieved!.signature
    );
    expect(isValid).toBe(false);
  });

  it('should fail verification with modified signature', async () => {
    const artifactData = Buffer.from('test artifact');
    const artifactKey = 'deployment-sig-tampering';

    // Sign and store
    const { checksum, signature } = artifactSigningService.signArtifact(
      artifactData
    );
    await mockStorage.storeArtifact(
      artifactKey,
      artifactData,
      checksum,
      signature
    );

    // Retrieve
    const retrieved = await mockStorage.retrieveArtifact(artifactKey);

    // Tamper with signature
    const modifiedSignature = 'b'.repeat(64);

    // Verify should fail
    const isValid = artifactSigningService.verifyArtifact(
      retrieved!.data,
      retrieved!.checksum,
      modifiedSignature
    );
    expect(isValid).toBe(false);
  });

  it('should handle string artifacts correctly', () => {
    const artifactString = 'deployment configuration string';

    const { checksum, signature } = artifactSigningService.signArtifact(
      artifactString
    );

    const isValid = artifactSigningService.verifyArtifact(
      artifactString,
      checksum,
      signature
    );
    expect(isValid).toBe(true);

    // Modify string and verify fails
    const modifiedString = 'deployment configuration string modified';
    const isModifiedValid = artifactSigningService.verifyArtifact(
      modifiedString,
      checksum,
      signature
    );
    expect(isModifiedValid).toBe(false);
  });

  it('should produce consistent checksums for same artifact', () => {
    const artifactData = Buffer.from('deterministic artifact');

    const sign1 = artifactSigningService.signArtifact(artifactData);
    const sign2 = artifactSigningService.signArtifact(artifactData);

    expect(sign1.checksum).toBe(sign2.checksum);
    expect(sign1.signature).toBe(sign2.signature);
  });

  it('should handle large artifacts', async () => {
    // Create a 10MB artifact
    const largeData = Buffer.alloc(10 * 1024 * 1024, 'x');

    const { checksum, signature } = artifactSigningService.signArtifact(
      largeData
    );

    const isValid = artifactSigningService.verifyArtifact(
      largeData,
      checksum,
      signature
    );
    expect(isValid).toBe(true);
  });

  it('should return false (not throw) on verification failure', () => {
    const artifact = Buffer.from('test');
    const invalidChecksum = 'sha256:' + 'a'.repeat(64);
    const invalidSignature = 'b'.repeat(64);

    // Should not throw
    const result = artifactSigningService.verifyArtifact(
      artifact,
      invalidChecksum,
      invalidSignature
    );

    expect(result).toBe(false);
  });
});
