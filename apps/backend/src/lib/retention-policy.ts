export const RETENTION_POLICY = {
    tombstonedDeploymentPurge: {
        defaultDays: 30,
        envVar: 'DEPLOYMENT_TOMBSTONE_RETENTION_DAYS',
        label: 'tombstoned deployment purge',
    },
    analyticsPurge: {
        defaultDays: 90,
        envVar: 'ANALYTICS_RETENTION_DAYS',
        label: 'analytics purge',
    },
    auditLogCompaction: {
        defaultDays: 90,
        envVar: 'AUDIT_LOG_COMPACTION_RETENTION_DAYS',
        label: 'audit log compaction',
    },
} as const;

export const RETENTION_WINDOW_RELATIONSHIP =
    'The deployment lifecycle retention windows must satisfy: analyticsPurgeDays >= tombstonedDeploymentPurgeDays and auditLogCompactionDays >= tombstonedDeploymentPurgeDays.';

export type RetentionJob = keyof typeof RETENTION_POLICY;

export type RetentionWindows = {
    auditLogCompactionDays: number;
    analyticsPurgeDays: number;
    tombstonedDeploymentPurgeDays: number;
};

export function normalizeRetentionDays(days: number | undefined, fallback: number): number {
    if (typeof days !== 'number' || Number.isNaN(days) || !Number.isFinite(days)) {
        return fallback;
    }
    return days;
}

export function readRetentionDays(job: RetentionJob, env: NodeJS.ProcessEnv = process.env): number {
    const config = RETENTION_POLICY[job];
    const rawValue = env[config.envVar];
    const parsed = rawValue === undefined ? config.defaultDays : Number.parseInt(rawValue, 10);
    return normalizeRetentionDays(parsed, config.defaultDays);
}

export function getRetentionPolicyWindows(env: NodeJS.ProcessEnv = process.env): RetentionWindows {
    return {
        auditLogCompactionDays: readRetentionDays('auditLogCompaction', env),
        analyticsPurgeDays: readRetentionDays('analyticsPurge', env),
        tombstonedDeploymentPurgeDays: readRetentionDays('tombstonedDeploymentPurge', env),
    };
}

export function validateRetentionWindows(windows: RetentionWindows): RetentionWindows {
    const violations: string[] = [];

    if (windows.auditLogCompactionDays < windows.tombstonedDeploymentPurgeDays) {
        violations.push(
            `auditLogCompactionDays (${windows.auditLogCompactionDays}) cannot be shorter than tombstonedDeploymentPurgeDays (${windows.tombstonedDeploymentPurgeDays})`
        );
    }

    if (windows.analyticsPurgeDays < windows.tombstonedDeploymentPurgeDays) {
        violations.push(
            `analyticsPurgeDays (${windows.analyticsPurgeDays}) cannot be shorter than tombstonedDeploymentPurgeDays (${windows.tombstonedDeploymentPurgeDays})`
        );
    }

    if (violations.length > 0) {
        throw new Error(`Retention policy violation: ${violations.join('; ')}. ${RETENTION_WINDOW_RELATIONSHIP}`);
    }

    return windows;
}
