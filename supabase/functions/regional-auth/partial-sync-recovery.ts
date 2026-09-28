export interface PartialSignupSyncFailure {
  requestId: string;
  errors: Record<string, string>;
}

export interface PartialSignupSyncRecoveryDependencies {
  recordRetryableFailure(requestId: string, details: Record<string, unknown>): Promise<void>;
  repair(): Promise<void>;
  onRepairFailure(error: unknown): void;
}

export async function recoverPartialSignupSync(
  failure: PartialSignupSyncFailure,
  dependencies: PartialSignupSyncRecoveryDependencies,
): Promise<void> {
  await dependencies.recordRetryableFailure(`${failure.requestId}-sync-failure`, {
    reason: 'cross-region profile sync incomplete',
    failedRegions: Object.keys(failure.errors),
    errors: failure.errors,
    syncStatus: 'pending',
    needsRepair: true,
  });

  try {
    await dependencies.repair();
  } catch (error) {
    dependencies.onRepairFailure(error);
  }
}