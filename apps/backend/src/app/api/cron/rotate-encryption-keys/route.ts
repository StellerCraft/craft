import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withCronAuth } from '../../../../lib/api/cron-auth';
import { rotateProfileEncryptedColumns } from '../../../../lib/crypto/key-rotation';
import { KEY_VERSION } from '../../../../lib/crypto/field-encryption';
import { createLogger, resolveCorrelationId, CORRELATION_ID_HEADER } from '../../../../lib/api/logger';

const currentEncryptionKeyName = KEY_VERSION === 1
  ? 'FIELD_ENCRYPTION_KEY'
  : `FIELD_ENCRYPTION_KEY_${KEY_VERSION}`;

async function handleRotateEncryptionKeys(req: NextRequest) {
  const correlationId = resolveCorrelationId(req);
  const log = createLogger({ correlationId, service: 'key-rotation-cron' });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const currentEncryptionKey = process.env[currentEncryptionKeyName];

  if (!supabaseUrl || !serviceRoleKey) {
    log.error('Missing Supabase service role configuration', undefined, {
      missingVars: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
        (v) => !process.env[v]
      ),
    });
    return NextResponse.json(
      {
        error:
          'Missing Supabase service role configuration. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      },
      { status: 500, headers: { [CORRELATION_ID_HEADER]: correlationId } },
    );
  }

  if (!currentEncryptionKey || currentEncryptionKey.length !== 64) {
    log.error('Invalid or missing encryption key', undefined, {
      keyName: currentEncryptionKeyName,
      keyLength: currentEncryptionKey?.length,
      expectedLength: 64,
    });
    return NextResponse.json(
      {
        error: `${currentEncryptionKeyName} must be set to a 64-character hex key before rotating encrypted profile fields.`,
      },
      { status: 500, headers: { [CORRELATION_ID_HEADER]: correlationId } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    log.info('Starting encryption key rotation', { keyName: currentEncryptionKeyName });

    const summary = await rotateProfileEncryptedColumns(supabase);

    log.info('Encryption key rotation completed successfully', {
      keyName: currentEncryptionKeyName,
      summary,
    });

    const res = NextResponse.json({ rotated: summary });
    res.headers.set(CORRELATION_ID_HEADER, correlationId);
    return res;
  } catch (error: any) {
    log.error('Error running rotate-encryption-keys cron', error, {
      keyName: currentEncryptionKeyName,
    });
    const res = NextResponse.json(
      { error: error.message || 'Rotation failed' },
      { status: 500 },
    );
    res.headers.set(CORRELATION_ID_HEADER, correlationId);
    return res;
  }
}

/**
 * Cron: rotate field-level encryption for profile columns.
 *
 * This endpoint re-encrypts profile-level Stripe fields using the current
 * active FIELD_ENCRYPTION_KEY (or FIELD_ENCRYPTION_KEY_<N> when KEY_VERSION > 1).
 * It is guarded by CRON_SECRET and intended to run on a weekly schedule.
 *
 * Logging: emits structured logs with correlation ID and detailed metadata:
 *   - On success: rotation summary (counts of rows rotated per column)
 *   - On error: error details and configuration issues (missing env vars, invalid keys)
 *   All logs include the X-Correlation-Id header for tracing across systems.
 */
export const GET = withCronAuth(handleRotateEncryptionKeys);
