import { describe, it, expect } from 'vitest';
import { MOCK_DEPLOYMENTS, MOCK_ANALYTICS } from './deployment-fixtures';

const REQUIRED_ENVIRONMENTS = ['production', 'staging', 'preview', 'development'];
const REQUIRED_TRIGGERS = ['push', 'manual', 'schedule', 'api'];

describe('deployment-fixtures', () => {
    describe('MOCK_DEPLOYMENTS', () => {
        it('exports a non-empty array of deployments', () => {
            expect(Array.isArray(MOCK_DEPLOYMENTS)).toBe(true);
            expect(MOCK_DEPLOYMENTS.length).toBeGreaterThan(0);
        });

        it('each deployment has the required shape', () => {
            for (const dep of MOCK_DEPLOYMENTS) {
                expect(typeof dep.id).toBe('string');
                expect(dep.id.length).toBeGreaterThan(0);
                expect(typeof dep.name).toBe('string');
                expect(dep.name.length).toBeGreaterThan(0);
                expect(typeof dep.status).toBe('string');
                expect(dep.status.length).toBeGreaterThan(0);
                expect(typeof dep.environment).toBe('string');
                expect(dep.environment.length).toBeGreaterThan(0);
                expect(typeof dep.trigger).toBe('string');
                expect(dep.trigger.length).toBeGreaterThan(0);
                expect(dep.commit).toBeDefined();
                expect(typeof dep.commit.sha).toBe('string');
                expect(dep.commit.sha.length).toBeGreaterThan(0);
                expect(typeof dep.commit.message).toBe('string');
                expect(dep.commit.message.length).toBeGreaterThan(0);
                expect(typeof dep.commit.author).toBe('string');
                expect(dep.commit.author.length).toBeGreaterThan(0);
                expect(typeof dep.commit.branch).toBe('string');
                expect(dep.commit.branch.length).toBeGreaterThan(0);
                expect(dep.region).toBeDefined();
                expect(typeof dep.region.id).toBe('string');
                expect(dep.region.id.length).toBeGreaterThan(0);
                expect(typeof dep.region.label).toBe('string');
                expect(dep.region.label.length).toBeGreaterThan(0);
                expect(typeof dep.region.flag).toBe('string');
                expect(dep.region.flag.length).toBeGreaterThan(0);
                expect(typeof dep.createdAt).toBe('string');
                expect(new Date(dep.createdAt).toISOString()).toBe(dep.createdAt);
            }
        });

        it('all environments are valid deployment environments', () => {
            for (const dep of MOCK_DEPLOYMENTS) {
                expect(REQUIRED_ENVIRONMENTS).toContain(dep.environment);
            }
        });

        it('all triggers are valid deployment triggers', () => {
            for (const dep of MOCK_DEPLOYMENTS) {
                expect(REQUIRED_TRIGGERS).toContain(dep.trigger);
            }
        });

        it('createdAt dates are in the past', () => {
            const now = Date.now();
            for (const dep of MOCK_DEPLOYMENTS) {
                const created = new Date(dep.createdAt).getTime();
                expect(created).toBeLessThan(now);
            }
        });

        it('deployments with completedAt have durationSeconds', () => {
            for (const dep of MOCK_DEPLOYMENTS) {
                if (dep.completedAt) {
                    expect(dep.durationSeconds).toBeDefined();
                    expect(typeof dep.durationSeconds).toBe('number');
                    expect(dep.durationSeconds).toBeGreaterThan(0);
                }
            }
        });

        it('deployments with url have a valid https url', () => {
            for (const dep of MOCK_DEPLOYMENTS) {
                if (dep.url) {
                    expect(dep.url).toMatch(/^https:\/\//);
                }
            }
        });
    });

    describe('MOCK_ANALYTICS', () => {
        it('has all required analytics fields', () => {
            expect(typeof MOCK_ANALYTICS.totalDeployments).toBe('number');
            expect(typeof MOCK_ANALYTICS.successRate).toBe('number');
            expect(typeof MOCK_ANALYTICS.avgDurationSeconds).toBe('number');
            expect(typeof MOCK_ANALYTICS.activeDeployments).toBe('number');
            expect(typeof MOCK_ANALYTICS.failedLast24h).toBe('number');
            expect(typeof MOCK_ANALYTICS.deploymentsToday).toBe('number');
            expect(typeof MOCK_ANALYTICS.successRateTrend).toBe('number');
            expect(typeof MOCK_ANALYTICS.avgDurationTrend).toBe('number');
        });

        it('has sensible default values', () => {
            expect(MOCK_ANALYTICS.totalDeployments).toBeGreaterThan(0);
            expect(MOCK_ANALYTICS.successRate).toBeGreaterThan(0);
            expect(MOCK_ANALYTICS.successRate).toBeLessThanOrEqual(100);
            expect(MOCK_ANALYTICS.avgDurationSeconds).toBeGreaterThan(0);
            expect(MOCK_ANALYTICS.activeDeployments).toBeGreaterThanOrEqual(0);
            expect(MOCK_ANALYTICS.failedLast24h).toBeGreaterThanOrEqual(0);
            expect(MOCK_ANALYTICS.deploymentsToday).toBeGreaterThanOrEqual(0);
        });
    });
});
