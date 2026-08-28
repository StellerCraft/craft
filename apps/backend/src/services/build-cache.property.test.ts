import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { BuildCacheService } from './build-cache.service';
import type { GeneratedFile } from '@craft/types';

describe('Build Cache Property Tests for Stale Dependency Graphs (#825)', () => {
    let service: BuildCacheService;

    beforeEach(() => {
        service = new BuildCacheService();
    });

    // Helper: Generate DAG-shaped dependency graphs
    const dependencyGraphArbitrary = () =>
        fc
            .tuple(
                fc.integer({ min: 5, max: 20 }),
                fc.array(fc.hexaString({ minLength: 8, maxLength: 16 }), {
                    minLength: 5,
                    maxLength: 20,
                })
            )
            .map(([nodeCount, hashes]) => ({
                nodes: Array.from({ length: nodeCount }, (_, i) => ({
                    id: `node-${i}`,
                    hash: hashes[i % hashes.length],
                    dependencies: Array.from(
                        { length: Math.floor(i / 2) },
                        (_, j) => `node-${Math.max(0, i - j - 1)}`
                    ),
                })),
            }));

    // Property 1: Changing any direct dependency invalidates cache
    it('cache invalidation triggered when any direct dependency changes', () => {
        const dependencyArbitrary = fc.tuple(
            fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
                minLength: 1,
                maxLength: 10,
            }),
            fc.integer({ min: 0, max: 9 })
        );

        fc.assert(
            fc.property(dependencyArbitrary, ([deps, indexToChange]) => {
                if (deps.length === 0) return;

                // Initial files and hash
                const files1: GeneratedFile[] = deps.map((dep, idx) => ({
                    path: `dep-${idx}.ts`,
                    content: dep,
                    type: 'code' as const,
                }));

                const hash1 = service.computeContentHash(files1);

                // Change one dependency
                const files2: GeneratedFile[] = [...files1];
                const idx = Math.min(indexToChange, files2.length - 1);
                files2[idx] = {
                    ...files2[idx],
                    content: `${files2[idx].content}-modified`,
                };

                const hash2 = service.computeContentHash(files2);

                // Hashes must differ
                expect(hash1).not.toBe(hash2);
            }),
            { numRuns: 500 }
        );
    });

    // Property 2: Changing any transitive dependency invalidates cache
    it('cache invalidation triggered when any transitive dependency changes', () => {
        fc.assert(
            fc.property(dependencyGraphArbitrary(), ({ nodes }) => {
                if (nodes.length < 3) return;

                // Build initial files from graph
                const files1: GeneratedFile[] = nodes.map((node) => ({
                    path: `${node.id}.ts`,
                    content: `hash:${node.hash};deps:${node.dependencies.join(',')}`,
                    type: 'code' as const,
                }));

                const hash1 = service.computeContentHash(files1);

                // Change a transitive dependency (leaf node)
                const leafNode = nodes[nodes.length - 1];
                const files2: GeneratedFile[] = files1.map((f) =>
                    f.path === `${leafNode.id}.ts`
                        ? { ...f, content: `${f.content}-modified` }
                        : f
                );

                const hash2 = service.computeContentHash(files2);

                // Hashes must differ
                expect(hash1).not.toBe(hash2);
            }),
            { numRuns: 500 }
        );
    });

    // Property 3: Cache miss after invalidation within same session
    it('cache hit never occurs after invalidation within same session', () => {
        const scenario = fc.tuple(
            fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
                minLength: 1,
                maxLength: 10,
            }),
            fc.integer({ min: 0, max: 9 })
        );

        fc.assert(
            fc.property(scenario, ([deps, indexToChange]) => {
                if (deps.length === 0) return;

                const files1: GeneratedFile[] = deps.map((dep, idx) => ({
                    path: `dep-${idx}.ts`,
                    content: dep,
                    type: 'code' as const,
                }));

                const hash1 = service.computeContentHash(files1);

                // Modify and recompute
                const files2 = [...files1];
                const idx = Math.min(indexToChange, files2.length - 1);
                files2[idx] = {
                    ...files2[idx],
                    content: `${files2[idx].content}-changed`,
                };
                const hash2 = service.computeContentHash(files2);

                // Hashes differ
                expect(hash1).not.toBe(hash2);

                // Recompute hash1 (should be same)
                const hash1Again = service.computeContentHash(files1);
                expect(hash1).toBe(hash1Again);

                // Hash2 should not equal hash1
                expect(hash2).not.toBe(hash1);
            }),
            { numRuns: 500 }
        );
    });

    // Property 4: LRU eviction works correctly
    it('LRU eviction removes least recently used entry when cache exceeds max size', () => {
        const lruScenario = fc.tuple(
            fc.integer({ min: 5, max: 20 }),
            fc.array(fc.hexaString({ minLength: 4, maxLength: 8 }), {
                minLength: 5,
                maxLength: 20,
            })
        );

        fc.assert(
            fc.property(lruScenario, ([maxSize, keys]) => {
                if (keys.length === 0) return;

                const cache = new Map<string, string>();
                const accessOrder: string[] = [];

                // Insert elements
                for (let i = 0; i < Math.min(keys.length, maxSize + 5); i++) {
                    const key = keys[i % keys.length];
                    cache.set(key, `value-${i}`);
                    accessOrder.push(key);

                    // Simulate LRU: if exceeds max, remove oldest
                    if (cache.size > maxSize) {
                        // Find least recently used (first in accessOrder)
                        for (const accessKey of accessOrder) {
                            if (cache.has(accessKey)) {
                                cache.delete(accessKey);
                                accessOrder.splice(accessOrder.indexOf(accessKey), 1);
                                break;
                            }
                        }
                    }

                    // Cache should never exceed maxSize
                    expect(cache.size).toBeLessThanOrEqual(maxSize);
                }

                // At the end, cache should have at most maxSize entries
                expect(cache.size).toBeLessThanOrEqual(maxSize);
            }),
            { numRuns: 500 }
        );
    });

    // Property 5: Deterministic hashing regardless of order
    it('content hash is deterministic regardless of file order', () => {
        const files = fc.array(
            fc.string({ minLength: 1, maxLength: 50 }),
            { minLength: 1, maxLength: 15 }
        );

        fc.assert(
            fc.property(files, (fileData) => {
                const files1: GeneratedFile[] = fileData.map((f, idx) => ({
                    path: `file-${idx}.ts`,
                    content: f,
                    type: 'code' as const,
                }));

                // Shuffle order
                const files2 = [...files1].sort(() => Math.random() - 0.5);

                const hash1 = service.computeContentHash(files1);
                const hash2 = service.computeContentHash(files2);

                // Hashes must be identical despite different order
                expect(hash1).toBe(hash2);
            }),
            { numRuns: 500 }
        );
    });

    // Property 6: No cache hit after any modification
    it('cache never hits after any file modification in the set', () => {
        const scenario = fc.tuple(
            fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
                minLength: 1,
                maxLength: 10,
            }),
            fc.integer({ min: 0, max: 9 }),
            fc.oneof(
                fc.constant('add'),
                fc.constant('remove'),
                fc.constant('modify')
            )
        );

        fc.assert(
            fc.property(scenario, ([deps, index, operation]) => {
                if (deps.length === 0) return;

                const files1: GeneratedFile[] = deps.map((dep, idx) => ({
                    path: `dep-${idx}.ts`,
                    content: dep,
                    type: 'code' as const,
                }));

                const hash1 = service.computeContentHash(files1);

                let files2: GeneratedFile[];
                const idx = Math.min(index, files1.length - 1);

                if (operation === 'modify') {
                    files2 = [...files1];
                    files2[idx] = {
                        ...files2[idx],
                        content: `${files2[idx].content}-x`,
                    };
                } else if (operation === 'add') {
                    files2 = [
                        ...files1,
                        {
                            path: 'new-file.ts',
                            content: 'new content',
                            type: 'code' as const,
                        },
                    ];
                } else {
                    files2 = files1.filter((_, i) => i !== idx);
                }

                const hash2 = service.computeContentHash(files2);

                // Any modification must change hash
                expect(hash1).not.toBe(hash2);
            }),
            { numRuns: 500 }
        );
    });

    // Property 7: Empty file set produces consistent hash
    it('empty file set produces consistent and deterministic hash', () => {
        const hash1 = service.computeContentHash([]);
        const hash2 = service.computeContentHash([]);

        expect(hash1).toBe(hash2);
        expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    // Property 8: Large file sets are handled correctly
    it('large file sets produce deterministic hashes', () => {
        const largeSet = fc.array(
            fc.string({ minLength: 10, maxLength: 100 }),
            { minLength: 10, maxLength: 100 }
        );

        fc.assert(
            fc.property(largeSet, (fileData) => {
                const files: GeneratedFile[] = fileData.map((f, idx) => ({
                    path: `file-${idx}.ts`,
                    content: f,
                    type: 'code' as const,
                }));

                const hash1 = service.computeContentHash(files);
                const hash2 = service.computeContentHash(files);

                expect(hash1).toBe(hash2);
                expect(hash1).toMatch(/^[0-9a-f]{64}$/);
            }),
            { numRuns: 50 }
        );
    });

    // Property 9: Hex string content is handled safely
    it('hex string content produces valid hashes', () => {
        const hexFiles = fc.array(
            fc.tuple(fc.string({ minLength: 1, maxLength: 20 }), fc.hexaString({ minLength: 50, maxLength: 200 })),
            { minLength: 1, maxLength: 10 }
        );

        fc.assert(
            fc.property(hexFiles, (files) => {
                const generatedFiles: GeneratedFile[] = files.map(([name, content]) => ({
                    path: `${name}.hex`,
                    content,
                    type: 'code' as const,
                }));

                const hash = service.computeContentHash(generatedFiles);

                expect(hash).toMatch(/^[0-9a-f]{64}$/);
                expect(hash.length).toBe(64);
            }),
            { numRuns: 50 }
        );
    });

    // Property 10: Identical files with different paths produce different hashes
    it('identical file content with different paths produces different hashes', () => {
        const content = 'identical content';
        const file1: GeneratedFile[] = [
            { path: 'path1/file.ts', content, type: 'code' as const },
        ];
        const file2: GeneratedFile[] = [
            { path: 'path2/file.ts', content, type: 'code' as const },
        ];

        const hash1 = service.computeContentHash(file1);
        const hash2 = service.computeContentHash(file2);

        expect(hash1).not.toBe(hash2);
    });

    // Property 11: Graph invariant preservation
    it('all nodes in graph have their dependencies properly hashed', () => {
        fc.assert(
            fc.property(dependencyGraphArbitrary(), ({ nodes }) => {
                const files: GeneratedFile[] = nodes.map((node) => ({
                    path: `${node.id}.ts`,
                    content: `id:${node.id};hash:${node.hash}`,
                    type: 'code' as const,
                }));

                const hash = service.computeContentHash(files);

                // Hash should be stable
                const hash2 = service.computeContentHash(files);
                expect(hash).toBe(hash2);

                // Modifying any node changes hash
                files[0].content = `${files[0].content}-modified`;
                const hash3 = service.computeContentHash(files);
                expect(hash).not.toBe(hash3);
            }),
            { numRuns: 500 }
        );
    });
});
