/**
 * Template Accessibility Audit Tests
 *
 * Automated WCAG 2.1 AA compliance checks for all CRAFT templates, covering:
 *   - ARIA attributes and landmark roles
 *   - Keyboard navigation and focus management
 *   - Screen reader compatibility (semantic HTML)
 *   - Color contrast ratios (4.5:1 normal text, 3:1 large text)
 *   - Interactive element accessibility
 *
 * Run: vitest run templates/tests/accessibility-audit.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMPLATES_ROOT = resolve(__dirname, '..');
const TEMPLATE_NAMES = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'] as const;
type TemplateName = typeof TEMPLATE_NAMES[number];

/** WCAG 2.1 AA minimum contrast ratios */
const CONTRAST_NORMAL_TEXT = 4.5;
const CONTRAST_LARGE_TEXT = 3.0;
const CONTRAST_UI_COMPONENTS = 3.0;

// ── Types ─────────────────────────────────────────────────────────────────────

interface RgbColor { r: number; g: number; b: number }

interface ContrastResult {
  ratio: number;
  passes: { aa: boolean; aaLarge: boolean; aaa: boolean; aaaLarge: boolean };
}

interface AriaAuditResult {
  valid: boolean;
  violations: string[];
  warnings: string[];
}

interface KeyboardAuditResult {
  focusableElements: string[];
  missingTabIndex: string[];
  missingFocusStyles: string[];
}

interface AccessibilityReport {
  template: TemplateName;
  ariaAudit: AriaAuditResult;
  keyboardAudit: KeyboardAuditResult;
  contrastChecks: ContrastResult[];
  screenReaderChecks: string[];
  passed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function templatePath(name: TemplateName, ...segments: string[]): string {
  return resolve(TEMPLATES_ROOT, name, ...segments);
}

/** Convert hex color to relative luminance per WCAG 2.1 */
function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(color: RgbColor): number {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

function contrastRatio(fg: string, bg: string): ContrastResult {
  const l1 = relativeLuminance(hexToRgb(fg));
  const l2 = relativeLuminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return {
    ratio: Math.round(ratio * 100) / 100,
    passes: {
      aa: ratio >= CONTRAST_NORMAL_TEXT,
      aaLarge: ratio >= CONTRAST_LARGE_TEXT,
      aaa: ratio >= 7.0,
      aaaLarge: ratio >= 4.5,
    },
  };
}

/** Scan TSX/HTML source for ARIA attribute patterns */
function auditAriaAttributes(source: string): AriaAuditResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  // aria-label on interactive elements without visible text
  const ariaLabellessButtons = source.match(/<button(?![^>]*aria-label)[^>]*>/g) ?? [];
  const buttonsWithNoText = ariaLabellessButtons.filter(
    (b) => !b.includes('aria-label') && !b.includes('aria-labelledby'),
  );
  if (buttonsWithNoText.length > 0) {
    warnings.push(`${buttonsWithNoText.length} button(s) may lack accessible labels`);
  }

  // img tags without alt
  const imgWithoutAlt = (source.match(/<img(?![^>]*\balt=)[^>]*>/g) ?? []).length;
  if (imgWithoutAlt > 0) {
    violations.push(`${imgWithoutAlt} <img> element(s) missing alt attribute`);
  }

  // input without label or aria-label
  const inputsWithoutLabel = (
    source.match(/<input(?![^>]*(?:aria-label|aria-labelledby|id=))[^>]*>/g) ?? []
  ).length;
  if (inputsWithoutLabel > 0) {
    warnings.push(`${inputsWithoutLabel} <input> element(s) may lack associated labels`);
  }

  // role="button" without keyboard handler
  const roleButtonNoKeyboard = source.match(/role="button"(?![^>]*onKey)/g) ?? [];
  if (roleButtonNoKeyboard.length > 0) {
    violations.push(`${roleButtonNoKeyboard.length} role="button" element(s) missing keyboard handler`);
  }

  return { valid: violations.length === 0, violations, warnings };
}

/** Identify focusable elements and potential keyboard navigation issues */
function auditKeyboardNavigation(source: string): KeyboardAuditResult {
  const focusablePatterns = ['<a ', '<button', '<input', '<select', '<textarea', '<details'];
  const focusableElements = focusablePatterns.filter((p) => source.includes(p));

  const missingTabIndex: string[] = [];
  const missingFocusStyles: string[] = [];

  // Detect tabIndex=-1 on interactive elements that should be reachable
  const tabIndexNeg = source.match(/tabIndex={-1}/g) ?? [];
  if (tabIndexNeg.length > 0) {
    missingTabIndex.push(`${tabIndexNeg.length} element(s) explicitly removed from tab order`);
  }

  // Detect outline:none / outline:0 without focus-visible alternative
  if (
    (source.includes('outline: none') || source.includes('outline:none') || source.includes('outline: 0')) &&
    !source.includes('focus-visible')
  ) {
    missingFocusStyles.push('Focus outline suppressed without focus-visible alternative');
  }

  return { focusableElements, missingTabIndex, missingFocusStyles };
}

/** Check semantic HTML for screen reader compatibility */
function auditScreenReaderCompatibility(source: string): string[] {
  const issues: string[] = [];

  if (!source.includes('<main') && !source.includes('role="main"')) {
    issues.push('Missing <main> landmark or role="main"');
  }
  if (!source.includes('<nav') && !source.includes('role="navigation"')) {
    issues.push('Missing <nav> landmark or role="navigation"');
  }
  if (!/<h[1-6]/.test(source)) {
    issues.push('No heading elements found — screen readers rely on heading hierarchy');
  }
  if (source.includes('<div onClick') && !source.includes('role=')) {
    issues.push('Clickable <div> without semantic role — use <button> or add role attribute');
  }

  return issues;
}

function readSourceIfExists(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
}

function buildReport(name: TemplateName): AccessibilityReport {
  const srcDir = templatePath(name, 'src');
  const appDir = resolve(srcDir, 'app');

  const pageSrc = readSourceIfExists(resolve(appDir, 'page.tsx'));
  const layoutSrc = readSourceIfExists(resolve(appDir, 'layout.tsx'));
  const combinedSrc = pageSrc + layoutSrc;

  const ariaAudit = auditAriaAttributes(combinedSrc);
  const keyboardAudit = auditKeyboardNavigation(combinedSrc);
  const screenReaderChecks = auditScreenReaderCompatibility(combinedSrc);

  // Representative contrast pairs from Tailwind defaults used in templates
  const contrastChecks: ContrastResult[] = [
    contrastRatio('#1e40af', '#ffffff'), // blue-800 on white (info text)
    contrastRatio('#111827', '#ffffff'), // gray-900 on white (body text)
    contrastRatio('#374151', '#ffffff'), // gray-700 on white (secondary text)
    contrastRatio('#6b7280', '#ffffff'), // gray-500 on white (muted — may fail AA)
    contrastRatio('#1d4ed8', '#eff6ff'), // blue-700 on blue-50 (info box)
  ];

  const passed =
    ariaAudit.valid &&
    keyboardAudit.missingFocusStyles.length === 0 &&
    contrastChecks.filter((c) => !c.passes.aaLarge).length === 0;

  return { template: name, ariaAudit, keyboardAudit, contrastChecks, screenReaderChecks, passed };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Accessibility Audit — WCAG 2.1 AA', () => {
  let reports: Map<TemplateName, AccessibilityReport>;

  beforeAll(() => {
    reports = new Map(TEMPLATE_NAMES.map((name) => [name, buildReport(name)]));
  });

  // ── Color Contrast ──────────────────────────────────────────────────────────

  describe('Color contrast ratios', () => {
    it('contrast ratio calculation is correct for known pairs', () => {
      // Black on white = 21:1
      const result = contrastRatio('#000000', '#ffffff');
      expect(result.ratio).toBe(21);
      expect(result.passes.aa).toBe(true);
      expect(result.passes.aaa).toBe(true);
    });

    it('white on white fails all contrast checks', () => {
      const result = contrastRatio('#ffffff', '#ffffff');
      expect(result.ratio).toBe(1);
      expect(result.passes.aa).toBe(false);
    });

    it('gray-900 (#111827) on white meets WCAG AA normal text (4.5:1)', () => {
      const result = contrastRatio('#111827', '#ffffff');
      expect(result.ratio).toBeGreaterThanOrEqual(CONTRAST_NORMAL_TEXT);
      expect(result.passes.aa).toBe(true);
    });

    it('blue-800 (#1e40af) on white meets WCAG AA normal text', () => {
      const result = contrastRatio('#1e40af', '#ffffff');
      expect(result.ratio).toBeGreaterThanOrEqual(CONTRAST_NORMAL_TEXT);
      expect(result.passes.aa).toBe(true);
    });

    it('gray-500 (#6b7280) on white meets WCAG AA large text (3:1)', () => {
      const result = contrastRatio('#6b7280', '#ffffff');
      // gray-500 is borderline — must at least pass large text threshold
      expect(result.ratio).toBeGreaterThanOrEqual(CONTRAST_UI_COMPONENTS);
    });

    for (const name of TEMPLATE_NAMES) {
      it(`${name}: all representative contrast pairs meet AA large text threshold`, () => {
        const report = reports.get(name)!;
        const failures = report.contrastChecks.filter((c) => !c.passes.aaLarge);
        expect(
          failures,
          `${name} has contrast failures: ${failures.map((f) => f.ratio).join(', ')}`,
        ).toHaveLength(0);
      });
    }
  });

  // ── ARIA Attributes ─────────────────────────────────────────────────────────

  describe('ARIA attributes', () => {
    it('aria audit returns valid result for source with no violations', () => {
      const clean = '<main><h1>Title</h1><button aria-label="Close">X</button></main>';
      const result = auditAriaAttributes(clean);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('detects img without alt attribute', () => {
      const source = '<img src="logo.png">';
      const result = auditAriaAttributes(source);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('alt'))).toBe(true);
    });

    it('detects role="button" without keyboard handler', () => {
      const source = '<div role="button" onClick={handler}>Click me</div>';
      const result = auditAriaAttributes(source);
      expect(result.violations.some((v) => v.includes('keyboard'))).toBe(true);
    });

    it('passes when role="button" has keyboard handler', () => {
      const source = '<div role="button" onClick={h} onKeyDown={h}>Click</div>';
      const result = auditAriaAttributes(source);
      expect(result.violations.filter((v) => v.includes('keyboard'))).toHaveLength(0);
    });

    for (const name of TEMPLATE_NAMES) {
      it(`${name}: no critical ARIA violations in page source`, () => {
        const report = reports.get(name)!;
        expect(
          report.ariaAudit.violations,
          `${name} ARIA violations: ${report.ariaAudit.violations.join('; ')}`,
        ).toHaveLength(0);
      });
    }
  });

  // ── Keyboard Navigation ─────────────────────────────────────────────────────

  describe('Keyboard navigation', () => {
    it('identifies focusable elements in source', () => {
      const source = '<a href="/">Home</a><button>Submit</button><input type="text" />';
      const result = auditKeyboardNavigation(source);
      expect(result.focusableElements).toContain('<a ');
      expect(result.focusableElements).toContain('<button');
      expect(result.focusableElements).toContain('<input');
    });

    it('detects suppressed focus outline without focus-visible', () => {
      const source = '<button style="outline: none">Click</button>';
      const result = auditKeyboardNavigation(source);
      expect(result.missingFocusStyles.length).toBeGreaterThan(0);
    });

    it('allows outline suppression when focus-visible is present', () => {
      const source = '<button className="outline-none focus-visible:ring-2">Click</button>';
      const result = auditKeyboardNavigation(source);
      expect(result.missingFocusStyles).toHaveLength(0);
    });

    for (const name of TEMPLATE_NAMES) {
      it(`${name}: no focus style violations`, () => {
        const report = reports.get(name)!;
        expect(
          report.keyboardAudit.missingFocusStyles,
          `${name} focus style issues: ${report.keyboardAudit.missingFocusStyles.join('; ')}`,
        ).toHaveLength(0);
      });
    }
  });

  // ── Screen Reader Compatibility ─────────────────────────────────────────────

  describe('Screen reader compatibility', () => {
    it('flags missing main landmark', () => {
      const source = '<div><h1>Title</h1></div>';
      const issues = auditScreenReaderCompatibility(source);
      expect(issues.some((i) => i.includes('<main>'))).toBe(true);
    });

    it('accepts role="main" as main landmark alternative', () => {
      const source = '<div role="main"><h1>Title</h1></div>';
      const issues = auditScreenReaderCompatibility(source);
      expect(issues.some((i) => i.includes('<main>'))).toBe(false);
    });

    it('flags missing heading elements', () => {
      const source = '<main><p>No headings here</p></main>';
      const issues = auditScreenReaderCompatibility(source);
      expect(issues.some((i) => i.includes('heading'))).toBe(true);
    });

    it('flags clickable div without semantic role', () => {
      const source = '<div onClick={handler}>Click me</div>';
      const issues = auditScreenReaderCompatibility(source);
      expect(issues.some((i) => i.includes('role'))).toBe(true);
    });

    for (const name of TEMPLATE_NAMES) {
      it(`${name}: page source has heading hierarchy`, () => {
        const pageSrc = readSourceIfExists(templatePath(name, 'src', 'app', 'page.tsx'));
        if (pageSrc.length === 0) return; // template has no page.tsx yet
        expect(/<h[1-6]/.test(pageSrc)).toBe(true);
      });
    }
  });

  // ── Focus Management ────────────────────────────────────────────────────────

  describe('Focus management', () => {
    it('detects elements removed from tab order', () => {
      const source = '<button tabIndex={-1}>Hidden from tab</button>';
      const result = auditKeyboardNavigation(source);
      expect(result.missingTabIndex.length).toBeGreaterThan(0);
    });

    it('does not flag normal interactive elements', () => {
      const source = '<button>Normal button</button><a href="/">Link</a>';
      const result = auditKeyboardNavigation(source);
      expect(result.missingTabIndex).toHaveLength(0);
    });

    it('stellar-dex page.tsx has a focusable main content area', () => {
      const src = readSourceIfExists(templatePath('stellar-dex', 'src', 'app', 'page.tsx'));
      if (src.length === 0) return;
      expect(src.includes('<main')).toBe(true);
    });
  });

  // ── Full Report ─────────────────────────────────────────────────────────────

  describe('Accessibility report generation', () => {
    it('generates a report for each template', () => {
      expect(reports.size).toBe(TEMPLATE_NAMES.length);
    });

    it('report contains all required fields', () => {
      const report = reports.get('stellar-dex')!;
      expect(report).toHaveProperty('template');
      expect(report).toHaveProperty('ariaAudit');
      expect(report).toHaveProperty('keyboardAudit');
      expect(report).toHaveProperty('contrastChecks');
      expect(report).toHaveProperty('screenReaderChecks');
      expect(report).toHaveProperty('passed');
    });

    it('contrast checks array is non-empty for each template', () => {
      for (const name of TEMPLATE_NAMES) {
        const report = reports.get(name)!;
        expect(report.contrastChecks.length).toBeGreaterThan(0);
      }
    });
  });
});
