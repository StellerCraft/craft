import { describe, it, expect } from 'vitest';
import { applyFilters } from './DeploymentList';
import type { Deployment, DeploymentFilters } from '@/types/deployment';

const base: Omit<Deployment, 'id' | 'name' | 'status' | 'environment'> = {
  trigger: 'push',
  commit: {
    sha: 'abc1234',
    message: 'feat: add feature',
    author: 'dev@craft.com',
    branch: 'main',
  },
  region: { id: 'us-east-1', label: 'US East', flag: '🇺🇸' },
  createdAt: new Date().toISOString(),
};

const DEPS: Deployment[] = [
  { ...base, id: 'dep-1', name: 'alpha-service', status: 'success', environment: 'production' },
  { ...base, id: 'dep-2', name: 'beta-service', status: 'failed', environment: 'staging' },
  { ...base, id: 'dep-3', name: 'gamma-service', status: 'running', environment: 'production' },
  { ...base, id: 'dep-4', name: 'delta-service', status: 'queued', environment: 'preview' },
];

const allFilters: DeploymentFilters = { status: 'all', environment: 'all', search: '' };

describe('applyFilters', () => {
  it('returns all deployments when no filters are applied', () => {
    expect(applyFilters(DEPS, allFilters)).toHaveLength(4);
  });

  it('filters by status', () => {
    const result = applyFilters(DEPS, { ...allFilters, status: 'success' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('dep-1');
  });

  it('filters by environment', () => {
    const result = applyFilters(DEPS, { ...allFilters, environment: 'production' });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.id)).toEqual(['dep-1', 'dep-3']);
  });

  it('filters by search on name', () => {
    const result = applyFilters(DEPS, { ...allFilters, search: 'gamma' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('dep-3');
  });

  it('filters by search on commit message', () => {
    const result = applyFilters(DEPS, { ...allFilters, search: 'add feature' });
    expect(result).toHaveLength(4); // all share the same message
  });

  it('filters by search is case-insensitive', () => {
    const result = applyFilters(DEPS, { ...allFilters, search: 'ALPHA' });
    expect(result).toHaveLength(1);
  });

  it('combines status and environment filters', () => {
    const result = applyFilters(DEPS, {
      status: 'success',
      environment: 'production',
      search: '',
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('dep-1');
  });

  it('returns empty array when no match', () => {
    const result = applyFilters(DEPS, { ...allFilters, search: 'zzz-nonexistent' });
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(applyFilters([], allFilters)).toHaveLength(0);
  });
});
