import { describe, it, expect } from 'vitest';
import * as UI from '../src/index';

describe('@craft/ui', () => {
  it('should export without throwing', () => {
    expect(UI).toBeDefined();
  });

  it('should have an empty export surface initially', () => {
    const keys = Object.keys(UI);
    expect(keys.length).toBe(0);
  });
});
