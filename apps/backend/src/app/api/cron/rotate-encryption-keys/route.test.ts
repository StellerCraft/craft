import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const CRON_SECRET = 'test-cron-secret';
const SUPABASE_URL = 'https://example.supabase.co';
const SERVICE_KEY = 'service-role-key';

const mockCreateLogger = vi.fn(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../../lib/crypto/key-rotation', () => ({
  rotateProfileEncryptedColumns: vi.fn(),
}));

vi.mock('../../../../lib/api/logger', () => ({
  createLogger: mockCreateLogger,
  resolveCorrelationId: vi.fn((req: NextRequest) => 'test-correlation-id-123'),
  CORRELATION_ID_HEADER: 'X-Correlation-Id',
}));

function makeRequest(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers.authorization = authHeader;
  return new NextRequest('http://localhost/api/cron/rotate-encryption-keys', { headers });
}

describe('GET /api/cron/rotate-encryption-keys', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.FIELD_ENCRYPTION_KEY = 'b'.repeat(64);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY_0;
  });

  it('returns 401 when cron secret is invalid', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest('Bearer wrong-secret'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: invalid or missing cron signature' });
  });

  it('rotates encrypted profile columns successfully', async () => {
    const { rotateProfileEncryptedColumns } = await import('../../../../lib/crypto/key-rotation');
    vi.mocked(rotateProfileEncryptedColumns).mockResolvedValue({
      stripe_customer_id_encrypted: { total: 1, rotated: 1 },
      stripe_subscription_id_encrypted: { total: 1, rotated: 1 },
    });

    const { GET } = await import('./route');
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rotated: {
        stripe_customer_id_encrypted: { total: 1, rotated: 1 },
        stripe_subscription_id_encrypted: { total: 1, rotated: 1 },
      },
    });
    expect(rotateProfileEncryptedColumns).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the required encryption key environment variable is missing', async () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    const { GET } = await import('./route');

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/FIELD_ENCRYPTION_KEY/);
  });

  it('returns 500 when rotation fails partway through', async () => {
    const { rotateProfileEncryptedColumns } = await import('@/lib/crypto/key-rotation');
    vi.mocked(rotateProfileEncryptedColumns).mockRejectedValue(new Error('DB update failed'));

    const { GET } = await import('./route');
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('DB update failed');
    expect(rotateProfileEncryptedColumns).toHaveBeenCalledTimes(1);
  });

  it('logs structured info on successful rotation', async () => {
    const { rotateProfileEncryptedColumns } = await import('../../../../lib/crypto/key-rotation');
    const mockSummary = {
      stripe_customer_id_encrypted: { total: 100, rotated: 100 },
      stripe_subscription_id_encrypted: { total: 100, rotated: 100 },
    };
    vi.mocked(rotateProfileEncryptedColumns).mockResolvedValue(mockSummary);

    const { GET } = await import('./route');
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));

    expect(res.status).toBe(200);

    const mockLogger = mockCreateLogger.mock.results[0].value;
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Starting encryption key rotation',
      expect.objectContaining({ keyName: 'FIELD_ENCRYPTION_KEY' })
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Encryption key rotation completed successfully',
      expect.objectContaining({ summary: mockSummary })
    );
  });

  it('logs error with correlation ID on config validation failure', async () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    const { GET } = await import('./route');

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));

    expect(res.status).toBe(500);
    expect(res.headers.get('X-Correlation-Id')).toBe('test-correlation-id-123');

    const mockLogger = mockCreateLogger.mock.results[mockCreateLogger.mock.results.length - 1].value;
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Invalid or missing encryption key',
      undefined,
      expect.any(Object)
    );
  });

  it('logs error with correlation ID on rotation failure', async () => {
    const { rotateProfileEncryptedColumns } = await import('../../../../lib/crypto/key-rotation');
    vi.mocked(rotateProfileEncryptedColumns).mockRejectedValue(new Error('Database connection failed'));

    const { GET } = await import('./route');
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));

    expect(res.status).toBe(500);
    expect(res.headers.get('X-Correlation-Id')).toBe('test-correlation-id-123');

    const mockLogger = mockCreateLogger.mock.results[mockCreateLogger.mock.results.length - 1].value;
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error running rotate-encryption-keys cron',
      expect.any(Error),
      expect.any(Object)
    );
  });

  it('attaches correlation ID header to success response', async () => {
    const { rotateProfileEncryptedColumns } = await import('../../../../lib/crypto/key-rotation');
    vi.mocked(rotateProfileEncryptedColumns).mockResolvedValue({
      stripe_customer_id_encrypted: { total: 1, rotated: 1 },
    });

    const { GET } = await import('./route');
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Correlation-Id')).toBe('test-correlation-id-123');
  });
});
