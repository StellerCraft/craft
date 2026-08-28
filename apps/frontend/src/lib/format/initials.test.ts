import { describe, it, expect } from 'vitest';
import { getInitials } from './initials';

describe('getInitials', () => {
  it('returns the first letter of each of the first two words, uppercased', () => {
    expect(getInitials('John Doe')).toBe('JD');
  });

  it('returns a single initial for a single-word name', () => {
    expect(getInitials('Madonna')).toBe('M');
  });

  it('collapses extra internal whitespace between words', () => {
    expect(getInitials('John   Doe')).toBe('JD');
  });

  it('ignores leading and trailing whitespace', () => {
    expect(getInitials('  John Doe  ')).toBe('JD');
  });

  it('slices to a maximum of two characters for names with more than two words', () => {
    expect(getInitials('John Fitzgerald Doe')).toBe('JF');
  });

  it('returns an empty string for empty input', () => {
    expect(getInitials('')).toBe('');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(getInitials('   ')).toBe('');
  });
});
