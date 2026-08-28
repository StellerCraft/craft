/**
 * Integration test for TemplateCloningService file integrity verification
 *
 * Tests all four template types (stellar-dex, soroban-defi, payment-gateway, asset-issuance)
 * and verifies:
 *   - SHA-256 checksums of all files match between source and clone
 *   - File count in clone equals file count in source
 *   - Dot-files (.env.example, .gitignore) are cloned
 *   - No files are silently dropped
 *
 * Issue: #818
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { TemplateCloningService } from './template-cloning.service';

const TEMPLATES = [
  'stellar-dex',
  'soroban-defi',
  'payment-gateway',
  'asset-issuance',
];

const TEMPLATE_ROOT = path.resolve(process.cwd(), 'templates');
const WORKSPACE_ROOT = path.resolve(process.cwd(), '.test-workspaces');

async function computeFileChecksum(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function getAllFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

describe('TemplateCloningService - File Integrity Integration', () => {
  beforeAll(async () => {
    try {
      await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
    } catch {
      // Directory may already exist
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(WORKSPACE_ROOT, { recursive: true, force: true });
    } catch {
      // Cleanup may fail if directory doesn't exist
    }
  });

  for (const templateName of TEMPLATES) {
    it(`should clone ${templateName} with all files and matching checksums`, async () => {
      const sourceDir = path.join(TEMPLATE_ROOT, templateName);
      const runId = `test-${templateName}-${Date.now()}`;
      const workspaceDir = path.join(WORKSPACE_ROOT, runId);

      // Verify source directory exists
      try {
        await fs.access(sourceDir);
      } catch {
        expect.fail(`Template source directory not found: ${sourceDir}`);
      }

      // Clone template
      const cloningService = new TemplateCloningService();
      const cloneResult = await cloningService.clone({
        source: { type: 'local', path: sourceDir },
        workspaceRoot: WORKSPACE_ROOT,
        runId,
        placeholders: {},
      });

      expect(cloneResult.ok).toBe(true);
      expect(cloneResult.clonedPath).toBeDefined();

      const clonedPath = cloneResult.clonedPath!;

      // Verify cloned directory exists
      try {
        await fs.access(clonedPath);
      } catch {
        expect.fail(`Cloned directory not found: ${clonedPath}`);
      }

      // Get all files from source and clone
      const sourceFiles = await getAllFilesRecursive(sourceDir);
      const clonedFiles = await getAllFilesRecursive(clonedPath);

      // Verify file counts match
      expect(clonedFiles).toHaveLength(sourceFiles.length);

      // Verify checksums match for all files
      const checksumMismatches: string[] = [];
      for (const sourceFile of sourceFiles) {
        const relativePath = path.relative(sourceDir, sourceFile);
        const clonedFile = path.join(clonedPath, relativePath);

        const sourceChecksum = await computeFileChecksum(sourceFile);
        const clonedChecksum = await computeFileChecksum(clonedFile);

        if (sourceChecksum !== clonedChecksum) {
          checksumMismatches.push(relativePath);
        }
      }

      expect(checksumMismatches).toHaveLength(0);

      // Verify dot-files are cloned
      const dotFiles = sourceFiles
        .map((f) => path.basename(f))
        .filter((f) => f.startsWith('.'));

      if (dotFiles.length > 0) {
        for (const dotFile of dotFiles) {
          const clonedDotFiles = clonedFiles
            .map((f) => path.basename(f))
            .filter((f) => f === dotFile);
          expect(clonedDotFiles).toContain(dotFile);
        }
      }

      // Cleanup
      await fs.rm(workspaceDir, { recursive: true, force: true });
    });
  }

  it('should verify .env.example is cloned if present', async () => {
    const templateName = 'stellar-dex';
    const sourceDir = path.join(TEMPLATE_ROOT, templateName);
    const runId = `test-${templateName}-dotenv-${Date.now()}`;
    const workspaceDir = path.join(WORKSPACE_ROOT, runId);

    const cloningService = new TemplateCloningService();
    const cloneResult = await cloningService.clone({
      source: { type: 'local', path: sourceDir },
      workspaceRoot: WORKSPACE_ROOT,
      runId,
      placeholders: {},
    });

    expect(cloneResult.ok).toBe(true);

    const clonedPath = cloneResult.clonedPath!;
    const sourceFiles = await getAllFilesRecursive(sourceDir);
    const clonedFiles = await getAllFilesRecursive(clonedPath);

    const sourceEnvFiles = sourceFiles.filter((f) =>
      f.endsWith('.env.example') || f.endsWith('.env')
    );

    for (const envFile of sourceEnvFiles) {
      const relativePath = path.relative(sourceDir, envFile);
      const clonedEnvFile = path.join(clonedPath, relativePath);

      const fileExists = clonedFiles
        .map((f) => path.relative(clonedPath, f))
        .includes(relativePath);

      expect(fileExists).toBe(true);
    }

    // Cleanup
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('should verify file permissions are preserved', async () => {
    const templateName = 'stellar-dex';
    const sourceDir = path.join(TEMPLATE_ROOT, templateName);
    const runId = `test-${templateName}-perms-${Date.now()}`;
    const workspaceDir = path.join(WORKSPACE_ROOT, runId);

    const cloningService = new TemplateCloningService();
    const cloneResult = await cloningService.clone({
      source: { type: 'local', path: sourceDir },
      workspaceRoot: WORKSPACE_ROOT,
      runId,
      placeholders: {},
    });

    expect(cloneResult.ok).toBe(true);

    const clonedPath = cloneResult.clonedPath!;
    const sourceFiles = await getAllFilesRecursive(sourceDir);

    for (const sourceFile of sourceFiles) {
      const relativePath = path.relative(sourceDir, sourceFile);
      const clonedFile = path.join(clonedPath, relativePath);

      const sourceStats = await fs.stat(sourceFile);
      const clonedStats = await fs.stat(clonedFile);

      // Verify both are files (not directories)
      expect(sourceStats.isFile()).toBe(true);
      expect(clonedStats.isFile()).toBe(true);

      // Verify file mode is preserved (Unix permissions)
      expect(clonedStats.mode).toBe(sourceStats.mode);
    }

    // Cleanup
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });
});
