import { describe, it, expect } from 'vitest';
import { analyzeWasmOptimization, MAX_WASM_SIZE_BYTES } from './soroban';

/** Minimal valid WASM module: magic + version only, no sections. */
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function makeWasm(extraBytes = 0): Buffer {
  return Buffer.concat([WASM_MAGIC, Buffer.alloc(extraBytes)]);
}

describe('analyzeWasmOptimization', () => {
  it('returns withinLimit true for small binary', () => {
    const report = analyzeWasmOptimization(makeWasm(100));
    expect(report.withinLimit).toBe(true);
    expect(report.sizeBreakdown.total).toBe(108);
  });

  it('returns withinLimit false when binary exceeds MAX_WASM_SIZE_BYTES', () => {
    const report = analyzeWasmOptimization(Buffer.alloc(MAX_WASM_SIZE_BYTES + 1));
    expect(report.withinLimit).toBe(false);
  });

  it('returns empty issues for tiny binary with no sections', () => {
    const report = analyzeWasmOptimization(WASM_MAGIC);
    expect(report.issues).toHaveLength(0);
    expect(report.suggestions).toHaveLength(0);
    expect(report.totalEstimatedSavings).toBe(0);
  });

  it('handles non-WASM binary gracefully', () => {
    const report = analyzeWasmOptimization(Buffer.from('not wasm'));
    expect(report.withinLimit).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('handles Uint8Array input', () => {
    const bin = new Uint8Array(WASM_MAGIC);
    const report = analyzeWasmOptimization(bin);
    expect(report.sizeBreakdown.total).toBe(8);
  });

  it('detects debug custom section and suggests strip-debug-info', () => {
    // Custom section (id=0) with name "name"
    const nameSectionBody = Buffer.from([
      0x04, // name length = 4
      0x6e, 0x61, 0x6d, 0x65, // "name"
      0x01, 0x02, 0x03, // some content
    ]);
    const sectionSize = nameSectionBody.length;
    const sectionSizeEncoded = Buffer.from([sectionSize]); // single-byte LEB128
    const wasm = Buffer.concat([
      WASM_MAGIC,
      Buffer.from([0x00]), // section id = custom
      sectionSizeEncoded,
      nameSectionBody,
    ]);
    const report = analyzeWasmOptimization(wasm);
    const debugIssue = report.issues.find((i) => i.type === 'debug-section');
    expect(debugIssue).toBeDefined();
    expect(debugIssue?.action).toBe('strip-debug-info');
    expect(report.suggestions).toContain('strip-debug-info');
  });

  it('totalEstimatedSavings sums issue savings', () => {
    const nameSectionBody = Buffer.from([
      0x04, 0x6e, 0x61, 0x6d, 0x65, 0x01,
    ]);
    const wasm = Buffer.concat([
      WASM_MAGIC,
      Buffer.from([0x00, nameSectionBody.length]),
      nameSectionBody,
    ]);
    const report = analyzeWasmOptimization(wasm);
    const expected = report.issues.reduce((s, i) => s + i.estimatedSavings, 0);
    expect(report.totalEstimatedSavings).toBe(expected);
  });

  it('suggests enable-wasm-opt for a large binary near the limit', () => {
    // Fill a binary that is > 75% of limit with valid WASM header, rest zeros
    const size = Math.floor(MAX_WASM_SIZE_BYTES * 0.8);
    const wasm = Buffer.concat([WASM_MAGIC, Buffer.alloc(size - 8)]);
    const report = analyzeWasmOptimization(wasm);
    expect(report.suggestions).toContain('enable-wasm-opt');
  });

  it('sizeBreakdown.total equals binary length', () => {
    const wasm = makeWasm(500);
    const report = analyzeWasmOptimization(wasm);
    expect(report.sizeBreakdown.total).toBe(wasm.length);
  });

  it('suggestions array has no duplicates', () => {
    const wasm = makeWasm(MAX_WASM_SIZE_BYTES - 100);
    const report = analyzeWasmOptimization(wasm);
    const unique = [...new Set(report.suggestions)];
    expect(report.suggestions).toEqual(unique);
  });
});
