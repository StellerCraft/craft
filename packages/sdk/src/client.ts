/**
 * CRAFT API Client SDK
 *
 * Wraps the CRAFT platform REST API with typed methods for auth, templates,
 * deployments, and payments.
 */

export interface CraftClientOptions {
  baseUrl: string;
  accessToken?: string;
}

export interface SignUpRequest {
  email: string;
  password: string;
  fullName: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: { id: string; email: string; fullName?: string };
  session: { access_token: string; refresh_token: string };
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  subscriptionTier: string;
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  features: string[];
  previewUrl?: string;
  thumbnailUrl?: string;
}

export interface TemplateListResponse {
  templates: Template[];
  total: number;
  limit: number;
  offset: number;
}

export interface TemplateListOptions {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CheckoutRequest {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResponse {
  sessionId: string;
  url: string;
}

export interface SubscriptionStatus {
  subscriptionId: string;
  status: string;
  tier: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface DeploymentAnalytics {
  analytics: Array<{ id: string; metricType: string; metricValue: number; recordedAt: string }>;
  summary: { totalPageViews: number; uptimePercentage: number; totalTransactions: number; lastChecked: string };
}

export interface DeploymentHealth {
  isHealthy: boolean;
  responseTime: number;
  statusCode: number;
  error: string | null;
  lastChecked: string;
}

export class CraftApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CraftApiError';
  }
}

export class CraftClient {
  private baseUrl: string;
  private accessToken?: string;

  constructor(options: CraftClientOptions) {
    if (!options.baseUrl) throw new Error('baseUrl is required');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken = options.accessToken;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'API-Version': 'v1',
    };
    if (this.accessToken) h['Authorization'] = `Bearer ${this.accessToken}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new CraftApiError(res.status, text);
    }
    return res.json() as Promise<T>;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async signUp(data: SignUpRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>('POST', '/api/auth/signup', data);
  }

  async signIn(data: SignInRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>('POST', '/api/auth/signin', data);
  }

  async signOut(): Promise<{ message: string }> {
    return this.request<{ message: string }>('POST', '/api/auth/signout');
  }

  async getUser(): Promise<UserProfile> {
    return this.request<UserProfile>('GET', '/api/auth/user');
  }

  async updateProfile(data: Partial<Pick<UserProfile, 'fullName'>>): Promise<UserProfile> {
    return this.request<UserProfile>('PATCH', '/api/auth/profile', data);
  }

  // ── Templates ─────────────────────────────────────────────────────────────

  async listTemplates(options: TemplateListOptions = {}): Promise<TemplateListResponse> {
    const params = new URLSearchParams();
    if (options.category) params.set('category', options.category);
    if (options.search) params.set('search', options.search);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const qs = params.toString();
    return this.request<TemplateListResponse>('GET', `/api/templates${qs ? `?${qs}` : ''}`);
  }

  async getTemplate(id: string): Promise<Template> {
    return this.request<Template>('GET', `/api/templates/${id}`);
  }

  async getTemplateMetadata(id: string): Promise<unknown> {
    return this.request<unknown>('GET', `/api/templates/${id}/metadata`);
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  async createCheckout(data: CheckoutRequest): Promise<CheckoutResponse> {
    return this.request<CheckoutResponse>('POST', '/api/payments/checkout', data);
  }

  async getSubscription(): Promise<SubscriptionStatus> {
    return this.request<SubscriptionStatus>('GET', '/api/payments/subscription');
  }

  async cancelSubscription(): Promise<SubscriptionStatus> {
    return this.request<SubscriptionStatus>('POST', '/api/payments/cancel');
  }

  // ── Deployments ───────────────────────────────────────────────────────────

  async getDeploymentAnalytics(
    deploymentId: string,
    options: { metricType?: string; startDate?: string; endDate?: string } = {},
  ): Promise<DeploymentAnalytics> {
    const params = new URLSearchParams();
    if (options.metricType) params.set('metricType', options.metricType);
    if (options.startDate) params.set('startDate', options.startDate);
    if (options.endDate) params.set('endDate', options.endDate);
    const qs = params.toString();
    return this.request<DeploymentAnalytics>(
      'GET',
      `/api/deployments/${deploymentId}/analytics${qs ? `?${qs}` : ''}`,
    );
  }

  async getDeploymentHealth(deploymentId: string): Promise<DeploymentHealth> {
    return this.request<DeploymentHealth>('GET', `/api/deployments/${deploymentId}/health`);
  }
}
