import { describe, it, expect } from 'vitest';
import {
    validateUploadMetadata,
    formatValidationErrors,
    type ValidationError,
} from './schema-validator';

describe('schema-validator', () => {
    describe('validateUploadMetadata', () => {
        it('should accept empty object', () => {
            const result = validateUploadMetadata({});
            expect(result.valid).toBe(true);
        });

        it('should accept valid filename', () => {
            const result = validateUploadMetadata({ filename: 'test.png' });
            expect(result.valid).toBe(true);
        });

        it('should reject non-string filename', () => {
            const result = validateUploadMetadata({ filename: 123 });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field === 'filename')).toBe(true);
            }
        });

        it('should reject empty filename', () => {
            const result = validateUploadMetadata({ filename: '' });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field === 'filename')).toBe(true);
            }
        });

        it('should reject filename exceeding 255 characters', () => {
            const longName = 'a'.repeat(256);
            const result = validateUploadMetadata({ filename: longName });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field === 'filename')).toBe(true);
            }
        });

        it('should accept valid description', () => {
            const result = validateUploadMetadata({
                description: 'A nice branding asset',
            });
            expect(result.valid).toBe(true);
        });

        it('should reject description exceeding 1000 characters', () => {
            const longDesc = 'a'.repeat(1001);
            const result = validateUploadMetadata({ description: longDesc });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field === 'description')).toBe(true);
            }
        });

        it('should accept valid tags array', () => {
            const result = validateUploadMetadata({ tags: ['logo', 'brand'] });
            expect(result.valid).toBe(true);
        });

        it('should reject non-array tags', () => {
            const result = validateUploadMetadata({ tags: 'logo,brand' });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field === 'tags')).toBe(true);
            }
        });

        it('should reject more than 20 tags', () => {
            const tags = Array(21).fill('tag');
            const result = validateUploadMetadata({ tags });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field === 'tags')).toBe(true);
            }
        });

        it('should reject non-string tags', () => {
            const result = validateUploadMetadata({ tags: [123, 'valid'] });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field.startsWith('tags'))).toBe(true);
            }
        });

        it('should reject empty tags', () => {
            const result = validateUploadMetadata({ tags: [''] });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field.startsWith('tags'))).toBe(true);
            }
        });

        it('should reject tags exceeding 50 characters', () => {
            const result = validateUploadMetadata({ tags: ['a'.repeat(51)] });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field.startsWith('tags'))).toBe(true);
            }
        });

        it('should accept valid category', () => {
            const result = validateUploadMetadata({ category: 'branding' });
            expect(result.valid).toBe(true);
        });

        it('should accept all valid categories', () => {
            const categories = ['branding', 'content', 'config', 'other'];
            for (const category of categories) {
                const result = validateUploadMetadata({ category });
                expect(result.valid).toBe(true);
            }
        });

        it('should reject invalid category', () => {
            const result = validateUploadMetadata({ category: 'invalid' });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field === 'category')).toBe(true);
            }
        });

        it('should reject non-string category', () => {
            const result = validateUploadMetadata({ category: 123 });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field === 'category')).toBe(true);
            }
        });

        it('should reject non-object metadata', () => {
            const result = validateUploadMetadata('not an object');
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors[0].field).toBe('metadata');
            }
        });

        it('should collect multiple validation errors', () => {
            const result = validateUploadMetadata({
                filename: 123,
                tags: 'not-array',
                category: 'invalid',
            });
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.length).toBeGreaterThanOrEqual(3);
            }
        });
    });

    describe('validateUploadMetadata malformed input', () => {
        it('does not throw for primitive inputs and returns structured diagnostics', () => {
            const inputs: unknown[] = [null, undefined, 42, true, 'a string', Symbol('x'), () => {}];
            for (const input of inputs) {
                expect(() => validateUploadMetadata(input)).not.toThrow();
                const result = validateUploadMetadata(input);
                expect(result.valid).toBe(false);
                if (!result.valid) {
                    expect(Array.isArray(result.errors)).toBe(true);
                    expect(result.errors.length).toBeGreaterThan(0);
                    expect(result.errors[0]).toMatchObject({
                        field: expect.any(String),
                        message: expect.any(String),
                    });
                }
            }
        });

        it('does not throw for an array or deeply nested/circular-shaped input', () => {
            expect(() => validateUploadMetadata([1, 2, 3])).not.toThrow();

            const weird: Record<string, unknown> = { filename: { nested: { deeper: true } } };
            expect(() => validateUploadMetadata(weird)).not.toThrow();
            const result = validateUploadMetadata(weird);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.some((e) => e.field === 'filename')).toBe(true);
            }
        });

        it('does not throw when tags contains non-primitive entries', () => {
            const input = { tags: [{ nested: true }, [1, 2], null, undefined] };
            expect(() => validateUploadMetadata(input)).not.toThrow();
            const result = validateUploadMetadata(input);
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.errors.every((e) => typeof e.field === 'string' && typeof e.message === 'string')).toBe(true);
            }
        });
    });

    describe('formatValidationErrors', () => {
        it('should format single error', () => {
            const errors: ValidationError[] = [
                { field: 'filename', message: 'Cannot be empty' },
            ];
            const result = formatValidationErrors(errors);
            expect(result).toContain('filename');
            expect(result).toContain('Cannot be empty');
        });

        it('should format multiple errors', () => {
            const errors: ValidationError[] = [
                { field: 'filename', message: 'Cannot be empty' },
                { field: 'tags', message: 'Must be an array' },
            ];
            const result = formatValidationErrors(errors);
            expect(result).toContain('Validation errors');
            expect(result).toContain('filename');
            expect(result).toContain('tags');
        });
    });
});
