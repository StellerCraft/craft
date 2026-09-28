import { describe, expect, it, vi } from 'vitest';
import { recoverPartialSignupSync } from './partial-sync-recovery.ts';

describe('partial signup sync recovery', () => {
  it('records a pending repair and attempts immediate recovery', async () => {
    const recordRetryableFailure = vi.fn().mockResolvedValue(undefined);
    const repair = vi.fn().mockRejectedValue(new Error('secondary region unavailable'));
    const onRepairFailure = vi.fn();

    await recoverPartialSignupSync(
      {
        userId: 'user-1',
        region: 'us-east-1',
        requestId: 'request-1',
        errors: { 'eu-west-1': 'connection timed out' },
      },
      { recordRetryableFailure, repair, onRepairFailure },
    );

    expect(recordRetryableFailure).toHaveBeenCalledWith(
      'request-1-sync-failure',
      expect.objectContaining({
        failedRegions: ['eu-west-1'],
        syncStatus: 'pending',
        needsRepair: true,
      }),
    );
    expect(repair).toHaveBeenCalledOnce();
    expect(onRepairFailure).toHaveBeenCalledWith(expect.any(Error));
  });
});