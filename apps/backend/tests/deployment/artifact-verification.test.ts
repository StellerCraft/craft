/**
 * Deployment Artifact Verification Tests
 *
 * Verifies that deployment artifacts are correctly generated, signed,
 * integrity-checked, and stored with accurate metadata.
 *
 * No live infrastructure required — artifact generation, signing, and
 * storage are all simulated in-memory.
 *
 * Artifact lifecycle (documented):
 *   1. Build step produces a bundle (JS/CSS/assets) with a content hash.
 *   2. Artifact is signed with the deployment service's private key (HMAC-SHA256).
 *   3. Metadata (version, timestamp, environment, checksums) is attached.
 *   4. Artifact is stored in the artifact registry with a unique artifact ID.
 *   5. Consumers verify the signature and checksum before deploying.
 *
 * Security requirements:
 *   - Signature must be verified before any deployment.
 *   - Tampered content must be detected via checksum mismatch.
 *   - Artifacts older than 30 days must be rejected.
 *   - Environment mismatch (staging artifact → production) must be rejected.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────

const SIGNING_SECRET = 'test-signing-secret-32-bytes-long!!';
const MAX_ARTIFACT_AGE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

// ── Types ─────────────────────────────────────────────────────────────────────

type Environment = 'development' | 'staging' | 'production';
type ArtifactStatus = 'pending' | 'signed' | 'verified' | 'rejected';

interface ArtifactFile {
  name: string;
  content: string;
  sizeBytes: number;
}

interface ArtifactMetadata {
  version: string;
  buildId: string;
  environment: Environment;
  createdAt: number; // unix ms
  commitSha: string;
  branch: string;
}

interface Artifact {
  id: string;
  files: ArtifactFile[];
  metadata: ArtifactMetadata;
  checksum: string;
  signature?: string;
  status: ArtifactStatus;
}

interface VerificationResult {
  valid: boolean;
  reason?: string;
}

interface ArtifactRegistry {
  artifacts: Map<string, Artifact>;
}

// ── Implementation ────────────────────────────────────────────────────────────

/** Deterministic checksum: sum of char codes of all file contents (simulates SHA-256). */
function computeChecksum(files: ArtifactFile[]): string {
  const combined = files.map(f => `${f.name}:${f.content}`).join('|');
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
  }
  return `sha256:${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/** Deterministic HMAC simulation: combines secret + checksum + metadata. */
function signArtifact(artifact: Artifact, secret: string): string {
  const payload = `${artifact.id}:${artifact.checksum}:${artifact.metadata.environment}:${artifact.metadata.createdAt}`;
  let sig = 0;
  const key = secret + payload;
  for (let i = 0; i < key.length; i++) {
    sig = ((sig << 5) - sig + key.charCodeAt(i)) | 0;
  }
  return `hmac:${Math.abs(sig).toString(16).padStart(16, '0')}`;
}

function generateArtifact(files: ArtifactFile[], metadata: ArtifactMetadata): Artifact {
  const id = `artifact_${metadata.buildId}_${metadata.environment}`;
  const checksum = computeChecksum(files);
  return { id, files, metadata, checksum, status: 'pending' };
}

function signArtifactWithSecret(artifact: Artifact, secret: string): Artifact {
  const signature = signArtifact(artifact, secret);
  return { ...artifact, signature, status: 'signed' };
}

function verifyArtifact(
  artifact: Artifact,
  secret: string,
  targetEnvironment: Environment,
  nowMs: number,
): VerificationResult {
  if (!artifact.signature) return { valid: false, reason: 'missing_signature' };

  // Verify signature
  const expectedSig = signArtifact(artifact, secret);
  if (artifact.signature !== expectedSig) return { valid: false, reason: 'invalid_signature' };

  // Verify checksum integrity
  const expectedChecksum = computeChecksum(artifact.files);
  if (artifact.checksum !== expectedChecksum) return { valid: false, reason: 'checksum_mismatch' };

  // Verify environment
  if (artifact.metadata.environment !== targetEnvironment) {
    return { valid: false, reason: 'environment_mismatch' };
  }

  // Verify age
  const ageMs = nowMs - artifact.metadata.createdAt;
  if (ageMs > MAX_ARTIFACT_AGE_DAYS * MS_PER_DAY) return { valid: false, reason: 'artifact_expired' };

  return { valid: true };
}

function storeArtifact(registry: ArtifactRegistry, artifact: Artifact): void {
  registry.artifacts.set(artifact.id, artifact);
}

function retrieveArtifact(registry: ArtifactRegistry, id: string): Artifact | undefined {
  return registry.artifacts.get(id);
}

function tamperArtifact(artifact: Artifact): Artifact {
  return {
    ...artifact,
    files: artifact.files.map((f, i) => i === 0 ? { ...f, content: f.content + '_TAMPERED' } : f),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000; // fixed timestamp

function makeFiles(): ArtifactFile[] {
  return [
    { name: 'main.js', content: 'console.log("app")', sizeBytes: 18 },
    { name: 'main.css', content: 'body{margin:0}', sizeBytes: 14 },
    { name: 'index.html', content: '<html><body></body></html>', sizeBytes: 25 },
  ];
}

function makeMetadata(env: Environment = 'staging', createdAt = NOW): ArtifactMetadata {
  return {
    version: '1.2.3',
    buildId: 'build_abc123',
    environment: env,
    createdAt,
    commitSha: 'a1b2c3d4e5f6',
    branch: 'main',
  };
}

function makeSignedArtifact(env: Environment = 'staging', createdAt = NOW): Artifact {
  const artifact = generateArtifact(makeFiles(), makeMetadata(env, createdAt));
  return signArtifactWithSecret(artifact, SIGNING_SECRET);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Artifact generation', () => {
  it('generates artifact with correct ID format', () => {
    const artifact = generateArtifact(makeFiles(), makeMetadata());
    expect(artifact.id).toBe('artifact_build_abc123_staging');
  });

  it('computes a non-empty checksum', () => {
    const artifact = generateArtifact(makeFiles(), makeMetadata());
    expect(artifact.checksum).toMatch(/^sha256:[0-9a-f]+$/);
  });

  it('starts with pending status', () => {
    const artifact = generateArtifact(makeFiles(), makeMetadata());
    expect(artifact.status).toBe('pending');
  });

  it('stores all provided files', () => {
    const files = makeFiles();
    const artifact = generateArtifact(files, makeMetadata());
    expect(artifact.files).toHaveLength(3);
    expect(artifact.files.map(f => f.name)).toEqual(['main.js', 'main.css', 'index.html']);
  });

  it('different file contents produce different checksums', () => {
    const a = generateArtifact(makeFiles(), makeMetadata());
    const altFiles = makeFiles();
    altFiles[0].content = 'console.log("different")';
    const b = generateArtifact(altFiles, makeMetadata());
    expect(a.checksum).not.toBe(b.checksum);
  });

  it('attaches metadata to artifact', () => {
    const meta = makeMetadata('production');
    const artifact = generateArtifact(makeFiles(), meta);
    expect(artifact.metadata.environment).toBe('production');
    expect(artifact.metadata.version).toBe('1.2.3');
    expect(artifact.metadata.commitSha).toBe('a1b2c3d4e5f6');
  });
});

describe('Artifact signing', () => {
  it('transitions status to signed after signing', () => {
    const artifact = generateArtifact(makeFiles(), makeMetadata());
    const signed = signArtifactWithSecret(artifact, SIGNING_SECRET);
    expect(signed.status).toBe('signed');
  });

  it('attaches a non-empty signature', () => {
    const signed = makeSignedArtifact();
    expect(signed.signature).toMatch(/^hmac:[0-9a-f]+$/);
  });

  it('same artifact signed twice produces identical signatures', () => {
    const artifact = generateArtifact(makeFiles(), makeMetadata());
    const s1 = signArtifactWithSecret(artifact, SIGNING_SECRET);
    const s2 = signArtifactWithSecret(artifact, SIGNING_SECRET);
    expect(s1.signature).toBe(s2.signature);
  });

  it('different secrets produce different signatures', () => {
    const artifact = generateArtifact(makeFiles(), makeMetadata());
    const s1 = signArtifactWithSecret(artifact, SIGNING_SECRET);
    const s2 = signArtifactWithSecret(artifact, 'different-secret-32-bytes-long!!!');
    expect(s1.signature).not.toBe(s2.signature);
  });
});

describe('Artifact verification — valid artifact', () => {
  it('verifies a correctly signed staging artifact', () => {
    const artifact = makeSignedArtifact('staging');
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(true);
  });

  it('verifies a correctly signed production artifact', () => {
    const artifact = makeSignedArtifact('production');
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'production', NOW);
    expect(result.valid).toBe(true);
  });
});

describe('Artifact verification — signature checks', () => {
  it('rejects artifact with missing signature', () => {
    const artifact = generateArtifact(makeFiles(), makeMetadata());
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_signature');
  });

  it('rejects artifact with wrong signature', () => {
    const artifact = { ...makeSignedArtifact(), signature: 'hmac:deadbeef00000000' };
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_signature');
  });

  it('rejects artifact signed with wrong secret', () => {
    const artifact = signArtifactWithSecret(
      generateArtifact(makeFiles(), makeMetadata()),
      'wrong-secret-32-bytes-long!!!!!!',
    );
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_signature');
  });
});

describe('Artifact verification — integrity checks', () => {
  it('rejects tampered artifact (checksum mismatch)', () => {
    const signed = makeSignedArtifact();
    const tampered = tamperArtifact(signed);
    const result = verifyArtifact(tampered, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('checksum_mismatch');
  });

  it('detects single-byte change in any file', () => {
    const signed = makeSignedArtifact();
    const modified = {
      ...signed,
      files: signed.files.map((f, i) => i === 1 ? { ...f, content: f.content + 'x' } : f),
    };
    const result = verifyArtifact(modified, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(false);
  });
});

describe('Artifact verification — environment checks', () => {
  it('rejects staging artifact deployed to production', () => {
    const artifact = makeSignedArtifact('staging');
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'production', NOW);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('environment_mismatch');
  });

  it('rejects production artifact deployed to staging', () => {
    const artifact = makeSignedArtifact('production');
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('environment_mismatch');
  });

  it('accepts development artifact in development environment', () => {
    const artifact = makeSignedArtifact('development');
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'development', NOW);
    expect(result.valid).toBe(true);
  });
});

describe('Artifact verification — expiry checks', () => {
  it('rejects artifact older than 30 days', () => {
    const oldCreatedAt = NOW - (31 * MS_PER_DAY);
    const artifact = makeSignedArtifact('staging', oldCreatedAt);
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('artifact_expired');
  });

  it('accepts artifact exactly at 30-day boundary', () => {
    const createdAt = NOW - (30 * MS_PER_DAY);
    const artifact = makeSignedArtifact('staging', createdAt);
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(true);
  });

  it('accepts fresh artifact (1 day old)', () => {
    const createdAt = NOW - MS_PER_DAY;
    const artifact = makeSignedArtifact('staging', createdAt);
    const result = verifyArtifact(artifact, SIGNING_SECRET, 'staging', NOW);
    expect(result.valid).toBe(true);
  });
});

describe('Artifact storage and retrieval', () => {
  let registry: ArtifactRegistry;
  beforeEach(() => { registry = { artifacts: new Map() }; });

  it('stores and retrieves artifact by ID', () => {
    const artifact = makeSignedArtifact();
    storeArtifact(registry, artifact);
    expect(retrieveArtifact(registry, artifact.id)).toEqual(artifact);
  });

  it('returns undefined for unknown artifact ID', () => {
    expect(retrieveArtifact(registry, 'nonexistent')).toBeUndefined();
  });

  it('overwrites artifact with same ID', () => {
    const v1 = makeSignedArtifact();
    const v2 = { ...v1, metadata: { ...v1.metadata, version: '2.0.0' } };
    storeArtifact(registry, v1);
    storeArtifact(registry, v2);
    expect(retrieveArtifact(registry, v1.id)!.metadata.version).toBe('2.0.0');
  });

  it('stores multiple artifacts independently', () => {
    const staging = makeSignedArtifact('staging');
    const prod = makeSignedArtifact('production');
    storeArtifact(registry, staging);
    storeArtifact(registry, prod);
    expect(registry.artifacts.size).toBe(2);
  });

  it('retrieved artifact passes verification', () => {
    const artifact = makeSignedArtifact('staging');
    storeArtifact(registry, artifact);
    const retrieved = retrieveArtifact(registry, artifact.id)!;
    expect(verifyArtifact(retrieved, SIGNING_SECRET, 'staging', NOW).valid).toBe(true);
  });
});
