import { describe, expect, it } from 'vitest';
import {
    RETENTION_POLICY,
    RETENTION_WINDOW_RELATIONSHIP,
    getRetentionPolicyWindows,
    validateRetentionWindows,
} from './retention-policy';

describe('retention policy', () => {
    it('documents the required ordering relationship across deployment lifecycle jobs', () => {
        expect(RETENTION_POLICY.auditLogCompaction.defaultDays).toBeGreaterThanOrEqual(
            RETENTION_POLICY.tombstonedDeploymentPurge.defaultDays,
        );
        expect(RETENTION_POLICY.analyticsPurge.defaultDays).toBeGreaterThanOrEqual(
            RETENTION_POLICY.tombstonedDeploymentPurge.defaultDays,
        );
        expect(RETENTION_WINDOW_RELATIONSHIP).toContain('auditLogCompactionDays');
        expect(RETENTION_WINDOW_RELATIONSHIP).toContain('analyticsPurgeDays');
    });

    it('accepts the default retention windows for the deployment lifecycle jobs', () => {
        expect(() => validateRetentionWindows(getRetentionPolicyWindows())).not.toThrow();
    });

    it('rejects a config where compaction or analytics retention shrinks below tombstone purge', () => {
        expect(() =>
            validateRetentionWindows({
                auditLogCompactionDays: 29,
                analyticsPurgeDays: 90,
                tombstonedDeploymentPurgeDays: 30,
            })
        ).toThrow(/auditLogCompactionDays.*cannot be shorter/);

        expect(() =>
            validateRetentionWindows({
                auditLogCompactionDays: 90,
                analyticsPurgeDays: 15,
                tombstonedDeploymentPurgeDays: 30,
            })
        ).toThrow(/analyticsPurgeDays.*cannot be shorter/);
    });
});
