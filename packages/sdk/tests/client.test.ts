/**
 * API Client SDK Tests
 *
 * Tests the CraftClient SDK for:
 *   - Initialization and configuration
 *   - Auth methods (signUp, signIn, signOut, getUser, updateProfile)
 *   - Template methods (listTemplates, getTemplate, getTemplateMetadata)
 *   - Payment methods (createCheckout, getSubscription, cancelSubscription)
 *   - Deployment methods (getDeploymentAnalytics, getDeploymentHealth)
 *   - Error handling (4xx/5xx responses → CraftApiError)
 *   - TypeScript type correctness
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CraftClient,
  CraftApiError,
  type CraftClientOptions,
  type AuthResponse,
  type UserProfile,
  type TemplateListResponse,
  type Template,
  type CheckoutResponse,
  type SubscriptionStatus,
  type DeploymentAnalytics,
  type DeploymentHealth,
} from '../src/client';

// ── Fetch mock helpers ────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    statusText: String(status),
  });
}

const BASE_URL = 'https://craft.app';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AUTH_RESPONSE: AuthResponse = {
  user: { id: 'user-1', email: 'test@example.com', fullName: 'Test User' },
  session: { access_token: 'tok_abc', refresh_token: 'ref_abc' },
};

const USER_PROFILE: UserProfile = {
  id: 'user-1',
  email: 'test@example.com',
  fullName: 'Test User',
  subscriptionTier: 'pro',
  createdAt: '2024-01-01T00:00:00Z',
};

const TEMPLATE: Template = {
  id: 'tmpl-1',
  name: 'Stellar DEX',
  description: 'Decentralized exchange',
  category: 'dex',
  version: '1.0.0',
  features: ['swapping', 'charts'],
};

const TEMPLATE_LIST: TemplateListResponse = {
  templates: [TEMPLATE],
  total: 1,
  limit: 10,
  offset: 0,
};

const CHECKOUT: CheckoutResponse = {
  sessionId: 'cs_test_123',
  url: 'https://checkout.stripe.com/pay/cs_test_123',
};

const SUBSCRIPTION: SubscriptionStatus = {
  subscriptionId: 'sub_123',
  status: 'active',
  tier: 'pro',
  currentPeriodEnd: '2024-02-01T00:00:00Z',
  cancelAtPeriodEnd: false,
};

const ANALYTICS: DeploymentAnalytics = {
  analytics: [{ id: 'a1', metricType: 'page_view', metricValue: 100, recordedAt: '2024-01-15T10:00:00Z' }],
  summary: { totalPageViews: 100, uptimePercentage: 99.9, totalTransactions: 10, lastChecked: '2024-01-15T12:00:00Z' },
};

const HEALTH: DeploymentHealth = {
  isHealthy: true,
  responseTime: 200,
  statusCode: 200,
  error: null,
  lastChecked: '2024-01-15T12:00:00Z',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CraftClient initialization', () => {
  it('constructs with required baseUrl', () => {
    const client = new CraftClient({ baseUrl: BASE_URL });
    expect(client).toBeInstanceOf(CraftClient);
  });

  it('throws when baseUrl is empty', () => {
    expect(() => new CraftClient({ baseUrl: '' })).toThrow('baseUrl is required');
  });

  it('strips trailing slash from baseUrl', () => {
    const client = new CraftClient({ baseUrl: `${BASE_URL}/` });
    // Verify by checking a successful request uses the correct URL
    const fetch = mockFetch(AUTH_RESPONSE);
    vi.stubGlobal('fetch', fetch);
    client.signIn({ email: 'a@b.com', password: 'pw' });
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/auth/signin`);
    vi.unstubAllGlobals();
  });

  it('accepts an initial accessToken', () => {
    const client = new CraftClient({ baseUrl: BASE_URL, accessToken: 'tok_init' });
    const fetch = mockFetch(USER_PROFILE);
    vi.stubGlobal('fetch', fetch);
    client.getUser();
    expect(fetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer tok_init');
    vi.unstubAllGlobals();
  });

  it('setAccessToken updates the token used in subsequent requests', () => {
    const client = new CraftClient({ baseUrl: BASE_URL });
    client.setAccessToken('tok_new');
    const fetch = mockFetch(USER_PROFILE);
    vi.stubGlobal('fetch', fetch);
    client.getUser();
    expect(fetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer tok_new');
    vi.unstubAllGlobals();
  });

  it('omits Authorization header when no token is set', () => {
    const client = new CraftClient({ baseUrl: BASE_URL });
    const fetch = mockFetch(TEMPLATE_LIST);
    vi.stubGlobal('fetch', fetch);
    client.listTemplates();
    expect(fetch.mock.calls[0][1].headers['Authorization']).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('sends API-Version: v1 header on all requests', () => {
    const client = new CraftClient({ baseUrl: BASE_URL, accessToken: 'tok' });
    const fetch = mockFetch(TEMPLATE_LIST);
    vi.stubGlobal('fetch', fetch);
    client.listTemplates();
    expect(fetch.mock.calls[0][1].headers['API-Version']).toBe('v1');
    vi.unstubAllGlobals();
  });
});

describe('Auth methods', () => {
  let client: CraftClient;

  beforeEach(() => {
    client = new CraftClient({ baseUrl: BASE_URL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signUp sends POST /api/auth/signup with body', async () => {
    vi.stubGlobal('fetch', mockFetch(AUTH_RESPONSE, 201));
    const result = await client.signUp({ email: 'u@e.com', password: 'pw', fullName: 'U' });
    expect(result.user.email).toBe('test@example.com');
    expect(result.session.access_token).toBe('tok_abc');
  });

  it('signIn sends POST /api/auth/signin', async () => {
    vi.stubGlobal('fetch', mockFetch(AUTH_RESPONSE));
    const result = await client.signIn({ email: 'u@e.com', password: 'pw' });
    expect(result.session.access_token).toBeDefined();
  });

  it('signOut sends POST /api/auth/signout', async () => {
    const fetch = mockFetch({ message: 'Signed out successfully' });
    vi.stubGlobal('fetch', fetch);
    const result = await client.signOut();
    expect(result.message).toBe('Signed out successfully');
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/auth/signout`);
    expect(fetch.mock.calls[0][1].method).toBe('POST');
  });

  it('getUser sends GET /api/auth/user', async () => {
    const fetch = mockFetch(USER_PROFILE);
    vi.stubGlobal('fetch', fetch);
    const result = await client.getUser();
    expect(result.id).toBe('user-1');
    expect(result.subscriptionTier).toBe('pro');
    expect(fetch.mock.calls[0][1].method).toBe('GET');
  });

  it('updateProfile sends PATCH /api/auth/profile', async () => {
    const updated = { ...USER_PROFILE, fullName: 'New Name' };
    const fetch = mockFetch(updated);
    vi.stubGlobal('fetch', fetch);
    const result = await client.updateProfile({ fullName: 'New Name' });
    expect(result.fullName).toBe('New Name');
    expect(fetch.mock.calls[0][1].method).toBe('PATCH');
  });

  it('signUp throws CraftApiError on 409 conflict', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'Email already exists' }, 409));
    await expect(client.signUp({ email: 'dup@e.com', password: 'pw', fullName: 'D' }))
      .rejects.toBeInstanceOf(CraftApiError);
  });

  it('signIn throws CraftApiError on 401', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'Unauthorized' }, 401));
    const err = await client.signIn({ email: 'bad@e.com', password: 'wrong' }).catch(e => e);
    expect(err).toBeInstanceOf(CraftApiError);
    expect(err.status).toBe(401);
  });
});

describe('Template methods', () => {
  let client: CraftClient;

  beforeEach(() => {
    client = new CraftClient({ baseUrl: BASE_URL, accessToken: 'tok' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listTemplates sends GET /api/templates', async () => {
    const fetch = mockFetch(TEMPLATE_LIST);
    vi.stubGlobal('fetch', fetch);
    const result = await client.listTemplates();
    expect(result.templates).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/templates`);
  });

  it('listTemplates appends category query param', async () => {
    const fetch = mockFetch(TEMPLATE_LIST);
    vi.stubGlobal('fetch', fetch);
    await client.listTemplates({ category: 'dex' });
    expect(fetch.mock.calls[0][0]).toContain('category=dex');
  });

  it('listTemplates appends limit and offset', async () => {
    const fetch = mockFetch(TEMPLATE_LIST);
    vi.stubGlobal('fetch', fetch);
    await client.listTemplates({ limit: 5, offset: 10 });
    const url: string = fetch.mock.calls[0][0];
    expect(url).toContain('limit=5');
    expect(url).toContain('offset=10');
  });

  it('listTemplates appends search param', async () => {
    const fetch = mockFetch(TEMPLATE_LIST);
    vi.stubGlobal('fetch', fetch);
    await client.listTemplates({ search: 'dex' });
    expect(fetch.mock.calls[0][0]).toContain('search=dex');
  });

  it('getTemplate sends GET /api/templates/:id', async () => {
    const fetch = mockFetch(TEMPLATE);
    vi.stubGlobal('fetch', fetch);
    const result = await client.getTemplate('tmpl-1');
    expect(result.id).toBe('tmpl-1');
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/templates/tmpl-1`);
  });

  it('getTemplateMetadata sends GET /api/templates/:id/metadata', async () => {
    const meta = { id: 'tmpl-1', name: 'Stellar DEX', version: '1.0.0' };
    const fetch = mockFetch(meta);
    vi.stubGlobal('fetch', fetch);
    const result = await client.getTemplateMetadata('tmpl-1');
    expect(result).toEqual(meta);
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/templates/tmpl-1/metadata`);
  });

  it('getTemplate throws CraftApiError on 404', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'Not found' }, 404));
    const err = await client.getTemplate('missing').catch(e => e);
    expect(err).toBeInstanceOf(CraftApiError);
    expect(err.status).toBe(404);
  });
});

describe('Payment methods', () => {
  let client: CraftClient;

  beforeEach(() => {
    client = new CraftClient({ baseUrl: BASE_URL, accessToken: 'tok' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createCheckout sends POST /api/payments/checkout', async () => {
    const fetch = mockFetch(CHECKOUT);
    vi.stubGlobal('fetch', fetch);
    const result = await client.createCheckout({
      priceId: 'price_pro',
      successUrl: 'https://app.example.com/success',
      cancelUrl: 'https://app.example.com/cancel',
    });
    expect(result.sessionId).toBe('cs_test_123');
    expect(result.url).toContain('checkout.stripe.com');
    expect(fetch.mock.calls[0][1].method).toBe('POST');
  });

  it('getSubscription sends GET /api/payments/subscription', async () => {
    const fetch = mockFetch(SUBSCRIPTION);
    vi.stubGlobal('fetch', fetch);
    const result = await client.getSubscription();
    expect(result.status).toBe('active');
    expect(result.tier).toBe('pro');
    expect(fetch.mock.calls[0][1].method).toBe('GET');
  });

  it('cancelSubscription sends POST /api/payments/cancel', async () => {
    const cancelled = { ...SUBSCRIPTION, cancelAtPeriodEnd: true };
    const fetch = mockFetch(cancelled);
    vi.stubGlobal('fetch', fetch);
    const result = await client.cancelSubscription();
    expect(result.cancelAtPeriodEnd).toBe(true);
    expect(fetch.mock.calls[0][1].method).toBe('POST');
  });

  it('createCheckout throws CraftApiError on 401', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'Unauthorized' }, 401));
    await expect(
      client.createCheckout({ priceId: 'p', successUrl: 's', cancelUrl: 'c' }),
    ).rejects.toBeInstanceOf(CraftApiError);
  });

  it('getSubscription throws CraftApiError on 401 when unauthorized', async () => {
    // Request: GET /api/payments/subscription
    // Response: 401 Unauthorized { error: 'Unauthorized' }
    vi.stubGlobal('fetch', mockFetch({ error: 'Unauthorized' }, 401));
    const err = await client.getSubscription().catch(e => e);
    expect(err).toBeInstanceOf(CraftApiError);
    expect(err.status).toBe(401);
  });

  it('cancelSubscription throws CraftApiError on 500 internal error', async () => {
    // Request: POST /api/payments/cancel
    // Response: 500 Internal Server Error { error: 'Internal Server Error' }
    vi.stubGlobal('fetch', mockFetch({ error: 'Internal Server Error' }, 500));
    const err = await client.cancelSubscription().catch(e => e);
    expect(err).toBeInstanceOf(CraftApiError);
    expect(err.status).toBe(500);
  });

  it('throws CraftApiError with 401 if setAccessToken not called before protected method', async () => {
    // Request: GET /api/payments/subscription (without Authorization header)
    // Response: 401 Unauthorized { error: 'Unauthorized' }
    const unauthedClient = new CraftClient({ baseUrl: BASE_URL });
    vi.stubGlobal('fetch', mockFetch({ error: 'Unauthorized' }, 401));
    const err = await unauthedClient.getSubscription().catch(e => e);
    expect(err).toBeInstanceOf(CraftApiError);
    expect(err.status).toBe(401);
  });
});


describe('Deployment methods', () => {
  let client: CraftClient;

  beforeEach(() => {
    client = new CraftClient({ baseUrl: BASE_URL, accessToken: 'tok' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getDeploymentAnalytics sends GET /api/deployments/:id/analytics', async () => {
    const fetch = mockFetch(ANALYTICS);
    vi.stubGlobal('fetch', fetch);
    const result = await client.getDeploymentAnalytics('dep-1');
    expect(result.analytics).toHaveLength(1);
    expect(result.summary.uptimePercentage).toBe(99.9);
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/deployments/dep-1/analytics`);
  });

  it('getDeploymentAnalytics appends filter params', async () => {
    const fetch = mockFetch(ANALYTICS);
    vi.stubGlobal('fetch', fetch);
    await client.getDeploymentAnalytics('dep-1', {
      metricType: 'page_view',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });
    const url: string = fetch.mock.calls[0][0];
    expect(url).toContain('metricType=page_view');
    expect(url).toContain('startDate=2024-01-01');
    expect(url).toContain('endDate=2024-01-31');
  });

  it('getDeploymentHealth sends GET /api/deployments/:id/health', async () => {
    const fetch = mockFetch(HEALTH);
    vi.stubGlobal('fetch', fetch);
    const result = await client.getDeploymentHealth('dep-1');
    expect(result.isHealthy).toBe(true);
    expect(result.responseTime).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/deployments/dep-1/health`);
  });

  it('getDeploymentHealth reflects unhealthy status', async () => {
    const unhealthy: DeploymentHealth = { ...HEALTH, isHealthy: false, statusCode: 503, error: 'Service unavailable' };
    vi.stubGlobal('fetch', mockFetch(unhealthy));
    const result = await client.getDeploymentHealth('dep-2');
    expect(result.isHealthy).toBe(false);
    expect(result.error).toBe('Service unavailable');
  });

  it('getDeploymentAnalytics throws CraftApiError on 403', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'Forbidden' }, 403));
    const err = await client.getDeploymentAnalytics('dep-x').catch(e => e);
    expect(err).toBeInstanceOf(CraftApiError);
    expect(err.status).toBe(403);
  });

  it('getDeploymentHealth throws CraftApiError on 404 not found', async () => {
    // Request: GET /api/deployments/dep-missing/health
    // Response: 404 Not Found { error: 'Deployment not found' }
    vi.stubGlobal('fetch', mockFetch({ error: 'Deployment not found' }, 404));
    const err = await client.getDeploymentHealth('dep-missing').catch(e => e);
    expect(err).toBeInstanceOf(CraftApiError);
    expect(err.status).toBe(404);
  });
});

describe('CraftApiError', () => {
  it('has correct name and status', () => {
    const err = new CraftApiError(500, 'Internal Server Error');
    expect(err.name).toBe('CraftApiError');
    expect(err.status).toBe(500);
    expect(err.message).toBe('Internal Server Error');
  });

  it('is an instance of Error', () => {
    expect(new CraftApiError(400, 'Bad Request')).toBeInstanceOf(Error);
  });
});

describe('SDK type definitions', () => {
  it('CraftClientOptions requires baseUrl', () => {
    const opts: CraftClientOptions = { baseUrl: 'https://craft.app' };
    expect(opts.baseUrl).toBeDefined();
  });

  it('AuthResponse has user and session fields', () => {
    const r: AuthResponse = AUTH_RESPONSE;
    expect(r.user).toBeDefined();
    expect(r.session.access_token).toBeDefined();
  });

  it('Template has required fields', () => {
    const t: Template = TEMPLATE;
    expect(t.id).toBeDefined();
    expect(t.category).toBeDefined();
    expect(Array.isArray(t.features)).toBe(true);
  });

  it('DeploymentHealth has isHealthy boolean', () => {
    const h: DeploymentHealth = HEALTH;
    expect(typeof h.isHealthy).toBe('boolean');
  });
});
