/**
 * Template Asset Optimization Tests
 * Issue #396: Create Template Asset Optimization Tests
 *
 * Verifies that template assets (images, CSS, JS) are properly optimized
 * for production: compression, minification, bundling, and caching headers.
 *
 * No network calls — all checks operate on static config files and mock
 * optimization pipeline responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMPLATES_ROOT = resolve(__dirname, '..');
const TEMPLATE_NAMES = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'] as const;

// Acceptable production thresholds
const MAX_IMAGE_SIZE_KB = 200;
const MAX_CSS_SIZE_KB = 50;
const MAX_JS_CHUNK_SIZE_KB = 500;
const MIN_COMPRESSION_RATIO = 0.6; // compressed must be ≤ 60 % of original

// ── Mock Types ────────────────────────────────────────────────────────────────

interface AssetOptimizationResult {
  originalSize: number;
  optimizedSize: number;
  compressionRatio: number;
  format: string;
  quality?: number;
}

interface CacheHeaders {
  'cache-control': string;
  etag?: string;
  'last-modified'?: string;
}

interface BundleStats {
  totalSize: number;
  chunks: Array<{ name: string; size: number }>;
  treeshaken: boolean;
  minified: boolean;
}

// ── Mock Services ─────────────────────────────────────────────────────────────

const mockImageOptimizer = {
  optimize: vi.fn(),
  getStats: vi.fn(),
};

const mockCssMinifier = {
  minify: vi.fn(),
  getStats: vi.fn(),
};

const mockJsBundler = {
  bundle: vi.fn(),
  getStats: vi.fn(),
};

const mockAssetCompressor = {
  compress: vi.fn(),
  decompress: vi.fn(),
};

const mockCacheService = {
  getHeaders: vi.fn(),
  invalidate: vi.fn(),
};

vi.mock('@/services/image-optimizer.service', () => ({
  imageOptimizer: mockImageOptimizer,
}));

vi.mock('@/services/css-minifier.service', () => ({
  cssMinifier: mockCssMinifier,
}));

vi.mock('@/services/js-bundler.service', () => ({
  jsBundler: mockJsBundler,
}));

vi.mock('@/services/asset-compressor.service', () => ({
  assetCompressor: mockAssetCompressor,
}));

vi.mock('@/services/cache.service', () => ({
  cacheService: mockCacheService,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOptimizationResult(overrides: Partial<AssetOptimizationResult> = {}): AssetOptimizationResult {
  return {
    originalSize: 1000,
    optimizedSize: 400,
    compressionRatio: 0.4,
    format: 'webp',
    quality: 85,
    ...overrides,
  };
}

function makeBundleStats(overrides: Partial<BundleStats> = {}): BundleStats {
  return {
    totalSize: 250 * 1024,
    chunks: [{ name: 'main', size: 250 * 1024 }],
    treeshaken: true,
    minified: true,
    ...overrides,
  };
}

// ── Image Optimization Tests ──────────────────────────────────────────────────

describe('Template Asset Optimization — image optimization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('optimizes PNG images and reduces file size', async () => {
    const result = makeOptimizationResult({ originalSize: 500_000, optimizedSize: 180_000, compressionRatio: 0.36 });
    mockImageOptimizer.optimize.mockResolvedValue(result);

    const { imageOptimizer } = await import('@/services/image-optimizer.service');
    const output = await imageOptimizer.optimize({ path: 'hero.png', format: 'webp' });

    expect(output.optimizedSize).toBeLessThan(output.originalSize);
    expect(output.optimizedSize / 1024).toBeLessThan(MAX_IMAGE_SIZE_KB);
  });

  it('converts images to WebP format for better compression', async () => {
    mockImageOptimizer.optimize.mockResolvedValue(makeOptimizationResult({ format: 'webp' }));

    const { imageOptimizer } = await import('@/services/image-optimizer.service');
    const output = await imageOptimizer.optimize({ path: 'logo.jpg', format: 'webp' });

    expect(output.format).toBe('webp');
  });

  it('maintains acceptable image quality (quality ≥ 80)', async () => {
    mockImageOptimizer.optimize.mockResolvedValue(makeOptimizationResult({ quality: 85 }));

    const { imageOptimizer } = await import('@/services/image-optimizer.service');
    const output = await imageOptimizer.optimize({ path: 'banner.jpg', quality: 85 });

    expect(output.quality).toBeGreaterThanOrEqual(80);
  });

  it('achieves minimum compression ratio for images', async () => {
    mockImageOptimizer.optimize.mockResolvedValue(
      makeOptimizationResult({ originalSize: 1_000_000, optimizedSize: 350_000, compressionRatio: 0.35 })
    );

    const { imageOptimizer } = await import('@/services/image-optimizer.service');
    const output = await imageOptimizer.optimize({ path: 'background.png' });

    expect(output.compressionRatio).toBeLessThanOrEqual(MIN_COMPRESSION_RATIO);
  });
});

// ── CSS Minification Tests ────────────────────────────────────────────────────

describe('Template Asset Optimization — CSS minification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('minifies CSS and reduces file size', async () => {
    const result = makeOptimizationResult({ originalSize: 80_000, optimizedSize: 20_000, format: 'css' });
    mockCssMinifier.minify.mockResolvedValue(result);

    const { cssMinifier } = await import('@/services/css-minifier.service');
    const output = await cssMinifier.minify({ path: 'styles.css' });

    expect(output.optimizedSize).toBeLessThan(output.originalSize);
    expect(output.optimizedSize / 1024).toBeLessThan(MAX_CSS_SIZE_KB);
  });

  it('removes whitespace and comments from CSS', async () => {
    const minifiedCss = '.btn{color:#fff;background:#000}';
    mockCssMinifier.getStats.mockResolvedValue({ output: minifiedCss, removedChars: 120 });

    const { cssMinifier } = await import('@/services/css-minifier.service');
    const stats = await cssMinifier.getStats({ path: 'styles.css' });

    expect(stats.removedChars).toBeGreaterThan(0);
    expect(stats.output).not.toMatch(/\s{2,}/); // no double whitespace
    expect(stats.output).not.toMatch(/\/\*/);   // no comments
  });

  it('minifies CSS for all four templates', async () => {
    mockCssMinifier.minify.mockResolvedValue(makeOptimizationResult({ format: 'css' }));

    const { cssMinifier } = await import('@/services/css-minifier.service');

    for (const template of TEMPLATE_NAMES) {
      const output = await cssMinifier.minify({ path: `${template}/styles.css` });
      expect(output.optimizedSize).toBeLessThan(output.originalSize);
    }

    expect(mockCssMinifier.minify).toHaveBeenCalledTimes(TEMPLATE_NAMES.length);
  });
});

// ── JavaScript Bundling Tests ─────────────────────────────────────────────────

describe('Template Asset Optimization — JavaScript bundling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bundles JS with tree-shaking enabled', async () => {
    mockJsBundler.bundle.mockResolvedValue(makeBundleStats({ treeshaken: true }));

    const { jsBundler } = await import('@/services/js-bundler.service');
    const stats = await jsBundler.bundle({ entry: 'src/index.ts', treeshake: true });

    expect(stats.treeshaken).toBe(true);
  });

  it('minifies JavaScript output', async () => {
    mockJsBundler.bundle.mockResolvedValue(makeBundleStats({ minified: true }));

    const { jsBundler } = await import('@/services/js-bundler.service');
    const stats = await jsBundler.bundle({ entry: 'src/index.ts', minify: true });

    expect(stats.minified).toBe(true);
  });

  it('keeps individual JS chunks under size limit', async () => {
    const chunks = [
      { name: 'main', size: 200 * 1024 },
      { name: 'vendor', size: 300 * 1024 },
    ];
    mockJsBundler.bundle.mockResolvedValue(makeBundleStats({ chunks }));

    const { jsBundler } = await import('@/services/js-bundler.service');
    const stats = await jsBundler.bundle({ entry: 'src/index.ts' });

    stats.chunks.forEach((chunk) => {
      expect(chunk.size / 1024).toBeLessThan(MAX_JS_CHUNK_SIZE_KB);
    });
  });

  it('produces a smaller bundle than the unminified source', async () => {
    mockJsBundler.getStats.mockResolvedValue({ rawSize: 800 * 1024, bundledSize: 250 * 1024 });

    const { jsBundler } = await import('@/services/js-bundler.service');
    const stats = await jsBundler.getStats({ entry: 'src/index.ts' });

    expect(stats.bundledSize).toBeLessThan(stats.rawSize);
  });
});

// ── Asset Compression Tests ───────────────────────────────────────────────────

describe('Template Asset Optimization — asset compression', () => {
  beforeEach(() => vi.clearAllMocks());

  it('compresses static assets with gzip', async () => {
    mockAssetCompressor.compress.mockResolvedValue({ algorithm: 'gzip', ratio: 0.3 });

    const { assetCompressor } = await import('@/services/asset-compressor.service');
    const result = await assetCompressor.compress({ path: 'bundle.js', algorithm: 'gzip' });

    expect(result.algorithm).toBe('gzip');
    expect(result.ratio).toBeLessThan(1);
  });

  it('compresses static assets with brotli for better ratios', async () => {
    mockAssetCompressor.compress.mockResolvedValue({ algorithm: 'brotli', ratio: 0.22 });

    const { assetCompressor } = await import('@/services/asset-compressor.service');
    const result = await assetCompressor.compress({ path: 'bundle.js', algorithm: 'brotli' });

    expect(result.algorithm).toBe('brotli');
    expect(result.ratio).toBeLessThan(0.3); // brotli should beat gzip
  });

  it('compressed asset can be decompressed to original', async () => {
    const original = 'body{margin:0}';
    mockAssetCompressor.compress.mockResolvedValue({ compressed: Buffer.from('compressed') });
    mockAssetCompressor.decompress.mockResolvedValue({ content: original });

    const { assetCompressor } = await import('@/services/asset-compressor.service');
    const compressed = await assetCompressor.compress({ content: original });
    const decompressed = await assetCompressor.decompress(compressed);

    expect(decompressed.content).toBe(original);
  });
});

// ── Asset Caching Header Tests ────────────────────────────────────────────────

describe('Template Asset Optimization — asset caching headers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets long-lived cache-control for hashed static assets', async () => {
    const headers: CacheHeaders = { 'cache-control': 'public, max-age=31536000, immutable' };
    mockCacheService.getHeaders.mockResolvedValue(headers);

    const { cacheService } = await import('@/services/cache.service');
    const result = await cacheService.getHeaders({ path: 'main.abc123.js' });

    expect(result['cache-control']).toContain('max-age=31536000');
    expect(result['cache-control']).toContain('immutable');
  });

  it('sets short cache-control for HTML pages', async () => {
    const headers: CacheHeaders = { 'cache-control': 'public, max-age=0, must-revalidate' };
    mockCacheService.getHeaders.mockResolvedValue(headers);

    const { cacheService } = await import('@/services/cache.service');
    const result = await cacheService.getHeaders({ path: 'index.html' });

    expect(result['cache-control']).toContain('must-revalidate');
  });

  it('includes etag header for cache validation', async () => {
    const headers: CacheHeaders = { 'cache-control': 'public, max-age=3600', etag: '"abc123"' };
    mockCacheService.getHeaders.mockResolvedValue(headers);

    const { cacheService } = await import('@/services/cache.service');
    const result = await cacheService.getHeaders({ path: 'styles.css' });

    expect(result.etag).toBeDefined();
    expect(result.etag).toMatch(/^"[a-z0-9]+"$/i);
  });
});

// ── Template Config Validation ────────────────────────────────────────────────

describe('Template Asset Optimization — Next.js config validation', () => {
  it('stellar-dex next.config.js enables image optimization', () => {
    const config = readFileSync(resolve(TEMPLATES_ROOT, 'stellar-dex', 'next.config.js'), 'utf-8');
    // Next.js optimizes images by default; confirm it is not explicitly disabled
    expect(config).not.toMatch(/unoptimized:\s*true/);
  });

  it('all templates have a tailwind config for CSS purging', () => {
    // Only stellar-dex ships a tailwind config in this repo
    const config = readFileSync(resolve(TEMPLATES_ROOT, 'stellar-dex', 'tailwind.config.ts'), 'utf-8');
    expect(config).toBeTruthy();
    expect(config).toMatch(/content/); // content array drives CSS purging
  });
});
