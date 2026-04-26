/**
 * ConfigValidator — validates JSON and YAML configuration files.
 * Feature: issue-070-implement-json-and-yaml-configuration-validation
 */

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  file: string;
  field?: string;
  message: string;
  severity: DiagnosticSeverity;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

/** Required top-level keys per well-known JSON config file (basename match). */
const REQUIRED_JSON_KEYS: Record<string, string[]> = {
  'package.json': ['name', 'version', 'scripts'],
  'vercel.json': ['version'],
  'turbo.json': ['tasks'],
};

export class ConfigValidator {
  validateJSON(filePath: string, content: string): ValidationResult {
    const diagnostics: Diagnostic[] = [];

    if (!content.trim()) {
      diagnostics.push({ file: filePath, message: 'JSON syntax error: empty content', severity: 'error' });
      return { valid: false, diagnostics };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diagnostics.push({ file: filePath, message: `JSON syntax error: ${msg}`, severity: 'error' });
      return { valid: false, diagnostics };
    }

    // Required-key checks for known filenames (match on basename).
    const basename = filePath.split('/').pop() ?? filePath;
    const requiredKeys = REQUIRED_JSON_KEYS[basename];
    if (requiredKeys && typeof parsed === 'object' && parsed !== null) {
      for (const key of requiredKeys) {
        if (!(key in (parsed as Record<string, unknown>))) {
          diagnostics.push({
            file: filePath,
            field: key,
            message: `Missing required field "${key}"`,
            severity: 'error',
          });
        }
      }
    }

    return { valid: diagnostics.length === 0, diagnostics };
  }

  validateYAML(filePath: string, content: string): ValidationResult {
    const diagnostics: Diagnostic[] = [];

    for (const line of content.split('\n')) {
      // Skip comment lines and blank lines.
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#') || trimmed === '') continue;

      // Tab indentation check.
      if (line.startsWith('\t') || /^\s*\t/.test(line)) {
        diagnostics.push({ file: filePath, message: 'YAML error: tab indentation is not allowed', severity: 'error' });
        break;
      }

      // Mapping key missing colon: a non-empty line that has no colon and is
      // not a list item or continuation.
      if (!line.includes(':') && !trimmed.startsWith('-') && trimmed.length > 0) {
        diagnostics.push({ file: filePath, message: 'YAML error: mapping key missing a colon', severity: 'error' });
        break;
      }
    }

    return { valid: diagnostics.length === 0, diagnostics };
  }

  validateFile(filePath: string, content: string): ValidationResult {
    if (filePath.endsWith('.json')) return this.validateJSON(filePath, content);
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return this.validateYAML(filePath, content);
    return { valid: true, diagnostics: [] };
  }

  validateAll(files: { path: string; content: string }[]): ValidationResult {
    const diagnostics: Diagnostic[] = [];
    for (const { path, content } of files) {
      diagnostics.push(...this.validateFile(path, content).diagnostics);
    }
    return { valid: diagnostics.length === 0, diagnostics };
  }
}

export const configValidator = new ConfigValidator();
