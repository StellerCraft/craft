/**
 * Unit tests for ConfigValidator
 * Feature: issue-070-implement-json-and-yaml-configuration-validation
 */

import { describe, it, expect } from 'vitest';
import { ConfigValidator, configValidator } from './config-validator.service';

describe('ConfigValidator', () => {
    // ── JSON validation ────────────────────────────────────────────────────────

    describe('validateJSON', () => {
        it('returns valid for well-formed JSON', () => {
            const result = configValidator.validateJSON('config.json', '{"name":"app","version":"1.0.0"}');
            expect(result.valid).toBe(true);
            expect(result.diagnostics).toHaveLength(0);
        });

        it('returns error for malformed JSON (trailing comma)', () => {
            const result = configValidator.validateJSON('config.json', '{"name":"app",}');
            expect(result.valid).toBe(false);
            expect(result.diagnostics[0].message).toMatch(/JSON syntax error/);
            expect(result.diagnostics[0].severity).toBe('error');
        });

        it('returns error for truncated JSON', () => {
            const result = configValidator.validateJSON('config.json', '{"name":');
            expect(result.valid).toBe(false);
            expect(result.diagnostics[0].severity).toBe('error');
        });

        it('returns error for JSON with unquoted key', () => {
            const result = configValidator.validateJSON('config.json', '{name:"app"}');
            expect(result.valid).toBe(false);
        });

        it('returns error for completely empty content', () => {
            const result = configValidator.validateJSON('config.json', '');
            expect(result.valid).toBe(false);
        });

        it('includes file path in diagnostic', () => {
            const result = configValidator.validateJSON('apps/web/package.json', '{bad}');
            expect(result.diagnostics[0].file).toBe('apps/web/package.json');
        });
    });

    // ── JSON required keys ─────────────────────────────────────────────────────

    describe('validateJSON — required keys', () => {
        it('flags missing "name" in package.json', () => {
            const content = JSON.stringify({ version: '1.0.0', scripts: {} });
            const result = configValidator.validateJSON('package.json', content);
            expect(result.valid).toBe(false);
            const diag = result.diagnostics.find((d) => d.field === 'name');
            expect(diag).toBeDefined();
            expect(diag!.message).toMatch(/"name"/);
        });

        it('flags missing "version" in package.json', () => {
            const content = JSON.stringify({ name: 'app', scripts: {} });
            const result = configValidator.validateJSON('package.json', content);
            expect(result.valid).toBe(false);
            expect(result.diagnostics.find((d) => d.field === 'version')).toBeDefined();
        });

        it('flags missing "scripts" in package.json', () => {
            const content = JSON.stringify({ name: 'app', version: '1.0.0' });
            const result = configValidator.validateJSON('package.json', content);
            expect(result.valid).toBe(false);
            expect(result.diagnostics.find((d) => d.field === 'scripts')).toBeDefined();
        });

        it('passes when all required keys are present in package.json', () => {
            const content = JSON.stringify({ name: 'app', version: '1.0.0', scripts: { dev: 'next dev' } });
            const result = configValidator.validateJSON('package.json', content);
            expect(result.valid).toBe(true);
        });

        it('flags missing "version" in vercel.json', () => {
            const content = JSON.stringify({ builds: [] });
            const result = configValidator.validateJSON('vercel.json', content);
            expect(result.valid).toBe(false);
            expect(result.diagnostics.find((d) => d.field === 'version')).toBeDefined();
        });

        it('flags missing "tasks" in turbo.json', () => {
            const content = JSON.stringify({ globalDependencies: [] });
            const result = configValidator.validateJSON('turbo.json', content);
            expect(result.valid).toBe(false);
            expect(result.diagnostics.find((d) => d.field === 'tasks')).toBeDefined();
        });

        it('does not check required keys for unknown JSON files', () => {
            const content = JSON.stringify({ foo: 'bar' });
            const result = configValidator.validateJSON('custom-config.json', content);
            expect(result.valid).toBe(true);
        });
    });

    // ── YAML validation ────────────────────────────────────────────────────────

    describe('validateYAML', () => {
        it('returns valid for well-formed YAML', () => {
            const yaml = `name: my-app\nversion: 1.0.0\nscripts:\n  dev: next dev\n`;
            const result = configValidator.validateYAML('config.yaml', yaml);
            expect(result.valid).toBe(true);
            expect(result.diagnostics).toHaveLength(0);
        });

        it('returns error for tab-indented YAML', () => {
            const yaml = `name: app\n\tversion: 1.0.0\n`;
            const result = configValidator.validateYAML('config.yaml', yaml);
            expect(result.valid).toBe(false);
            expect(result.diagnostics[0].message).toMatch(/tab indentation/);
            expect(result.diagnostics[0].severity).toBe('error');
        });

        it('returns error for mapping key missing colon', () => {
            const yaml = `name: app\nbadkey\nversion: 1.0.0\n`;
            const result = configValidator.validateYAML('config.yaml', yaml);
            expect(result.valid).toBe(false);
            expect(result.diagnostics[0].message).toMatch(/missing a colon/);
        });

        it('includes file path in diagnostic', () => {
            const yaml = `name: app\n\tbad: indent\n`;
            const result = configValidator.validateYAML('supabase/config.yaml', yaml);
            expect(result.diagnostics[0].file).toBe('supabase/config.yaml');
        });

        it('accepts .yml extension', () => {
            const yaml = `name: app\nversion: 1.0.0\n`;
            const result = configValidator.validateFile('docker-compose.yml', yaml);
            expect(result.valid).toBe(true);
        });

        it('ignores comment lines', () => {
            const yaml = `# this is a comment\nname: app\n`;
            const result = configValidator.validateYAML('config.yaml', yaml);
            expect(result.valid).toBe(true);
        });
    });

    // ── validateFile dispatch ──────────────────────────────────────────────────

    describe('validateFile', () => {
        it('dispatches .json to JSON validator', () => {
            const result = configValidator.validateFile('package.json', '{bad}');
            expect(result.valid).toBe(false);
            expect(result.diagnostics[0].message).toMatch(/JSON syntax error/);
        });

        it('dispatches .yaml to YAML validator', () => {
            const result = configValidator.validateFile('config.yaml', `name: app\n\tbad: indent\n`);
            expect(result.valid).toBe(false);
        });

        it('dispatches .yml to YAML validator', () => {
            const result = configValidator.validateFile('config.yml', `name: app\n\tbad: indent\n`);
            expect(result.valid).toBe(false);
        });

        it('returns valid for unknown file types', () => {
            const result = configValidator.validateFile('Dockerfile', 'FROM node:18');
            expect(result.valid).toBe(true);
        });
    });

    // ── validateAll ────────────────────────────────────────────────────────────

    describe('validateAll', () => {
        it('returns valid when all files pass', () => {
            const files = [
                { path: 'package.json', content: JSON.stringify({ name: 'app', version: '1.0.0', scripts: {} }) },
                { path: 'config.yaml', content: 'name: app\nversion: 1.0.0\n' },
            ];
            const result = configValidator.validateAll(files);
            expect(result.valid).toBe(true);
            expect(result.diagnostics).toHaveLength(0);
        });

        it('aggregates diagnostics from multiple files', () => {
            const files = [
                { path: 'package.json', content: '{bad}' },
                { path: 'config.yaml', content: `name: app\n\tbad: indent\n` },
            ];
            const result = configValidator.validateAll(files);
            expect(result.valid).toBe(false);
            expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
        });

        it('returns valid for empty file list', () => {
            const result = configValidator.validateAll([]);
            expect(result.valid).toBe(true);
        });

        it('attributes diagnostics to the correct file', () => {
            const files = [
                { path: 'good.json', content: '{"ok":true}' },
                { path: 'bad.json', content: '{bad}' },
            ];
            const result = configValidator.validateAll(files);
            expect(result.diagnostics.every((d) => d.file === 'bad.json')).toBe(true);
        });
    });
});
