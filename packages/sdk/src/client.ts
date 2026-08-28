/**
 * CRAFT API Client SDK
 *
 * Wraps the CRAFT platform REST API with typed methods for auth, templates,
 * deployments, and payments.
 */

/**
 * Configuration options for CraftClient.
 * @property baseUrl - The base URL of the CRAFT API (e.g., https://craft.app)
 * @property accessToken - Optional JWT access token for authenticated requests
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
  subscriptionTier: SubscriptionTier;
  createdAt: Date;
  githubConnected: boolean;
  githubUsername: string | null;
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

/**
 * Error thrown by CraftClient when an API request fails.
 * @property status - HTTP status code from the API response
 * @property message - Error message (from API response body or error description)
 */
export class CraftApiError extends Error {
  /**
   * Creates a new CraftApiError.
   * @param status - HTTP status code
   * @param message - Error message
   */
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'CraftApiError';
  }
}

export class CraftClient {
  private baseUrl: string;
  private accessToken?: string;

  /**
   * Creates a new CRAFT API client.
   * @param options - Client configuration
   * @throws Error if baseUrl is not provided
   */
  constructor(options: CraftClientOptions) {
    if (!options.baseUrl) throw new Error('baseUrl is required');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken = options.accessToken;
  }

  /**
   * Sets the access token for subsequent authenticated requests.
   * @param token - JWT access token
   */
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

  /**
   * Makes an HTTP request to the CRAFT API.
   * All failures — network-level and HTTP error responses — surface as CraftApiError.
   * When the error body is JSON matching ApiErrorResponse, the parsed message is used.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        let message = text;
        let code: string | undefined;
        try {
          const errorBody = JSON.parse(text) as Record<string, unknown>;
          if (errorBody.message && typeof errorBody.message === 'string') {
            message = errorBody.message;
          }
          if (errorBody.code && typeof errorBody.code === 'string') {
            code = errorBody.code;
          }
        } catch {
          // text is not JSON; use raw text as message
        }
        throw new CraftApiError(res.status, message, code);
      }
      return res.json() as Promise<T>;
    } catch (error) {
      if (error instanceof CraftApiError) throw error;
      throw new CraftApiError(0, `Network request failed: ${error instanceof Error ? error.message : String(error)}`, undefined);
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Creates a new user account.
   * @param data - Sign-up credentials and profile information
   * @returns User profile and session tokens
   * @throws CraftApiError on failure (e.g., 409 if email already exists)
   */
  async signUp(data: SignUpRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>('POST', '/api/auth/signup', data);
  }

  /**
   * Authenticates an existing user.
   * @param data - Login credentials
   * @returns User profile and session tokens
   * @throws CraftApiError on failure (e.g., 401 for invalid credentials)
   */
  async signIn(data: SignInRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>('POST', '/api/auth/signin', data);
  }

  /**
   * Signs out the current user and invalidates the session.
   * @returns Confirmation message
   * @throws CraftApiError on failure
   */
  async signOut(): Promise<{ message: string }> {
    return this.request<{ message: string }>('POST', '/api/auth/signout');
  }

  /**
   * Retrieves the authenticated user's profile.
   * @returns Current user's profile information
   * @throws CraftApiError on failure (e.g., 401 if not authenticated)
   */
  async getUser(): Promise<UserProfile> {
    return this.request<UserProfile>('GET', '/api/auth/user');
  }

  /**
   * Updates the authenticated user's profile.
   * @param data - Profile fields to update
   * @returns Updated user profile
   * @throws CraftApiError on failure
   */
  async updateProfile(data: Partial<Pick<UserProfile, 'fullName'>>): Promise<UserProfile> {
    return this.request<UserProfile>('PATCH', '/api/auth/profile', data);
  }

  // ── Templates ─────────────────────────────────────────────────────────────

  /**
   * Lists available CRAFT templates with optional filtering and pagination.
   * @param options - Filter and pagination options (category, search, limit, offset)
   * @returns Paginated list of templates
   * @throws CraftApiError on failure
   */
  async listTemplates(options: TemplateListOptions = {}): Promise<TemplateListResponse> {
    const params = new URLSearchParams();
    if (options.category) params.set('category', options.category);
    if (options.search) params.set('search', options.search);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const qs = params.toString();
    return this.request<TemplateListResponse>('GET', `/api/templates${qs ? `?${qs}` : ''}`);
  }

  /**
   * Retrieves a specific template by ID.
   * @param id - Template ID
   * @returns Template details
   * @throws CraftApiError on failure (e.g., 404 if not found)
   */
  async getTemplate(id: string): Promise<Template> {
    return this.request<Template>('GET', `/api/templates/${id}`);
  }

  /**
   * Retrieves metadata for a specific template.
   * @param id - Template ID
   * @returns Template metadata (structure depends on template type)
   * @throws CraftApiError on failure (e.g., 404 if not found)
   */
  async getTemplateMetadata(id: string): Promise<unknown> {
    return this.request<unknown>('GET', `/api/templates/${id}/metadata`);
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  /**
   * Creates a payment checkout session.
   * @param data - Checkout details (priceId, success/cancel URLs)
   * @returns Checkout session with URL to redirect user to payment flow
   * @throws CraftApiError on failure
   */
  async createCheckout(data: CheckoutRequest): Promise<CheckoutResponse> {
    return this.request<CheckoutResponse>('POST', '/api/payments/checkout', data);
  }

  /**
   * Retrieves the authenticated user's subscription status.
   * @returns Current subscription information
   * @throws CraftApiError on failure (e.g., 401 if not authenticated)
   */
  async getSubscription(): Promise<SubscriptionStatus> {
    return this.request<SubscriptionStatus>('GET', '/api/payments/subscription');
  }

  /**
   * Cancels the authenticated user's subscription.
   * @returns Updated subscription status (status: 'cancelled')
   * @throws CraftApiError on failure (e.g., 401 if not authenticated)
   */
  async cancelSubscription(): Promise<SubscriptionStatus> {
    return this.request<SubscriptionStatus>('POST', '/api/payments/cancel');
  }

  // ── Deployments ───────────────────────────────────────────────────────────

  /**
   * Retrieves analytics for a specific deployment.
   * @param deploymentId - Deployment ID
   * @param options - Optional filters (metricType, startDate, endDate as ISO strings)
   * @returns Deployment analytics with aggregated metrics and summary
   * @throws CraftApiError on failure (e.g., 403 for insufficient permissions, 404 if not found)
   */
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

  /**
   * Checks the health status of a specific deployment.
   * @param deploymentId - Deployment ID
   * @returns Deployment health status (uptime, response time, error info)
   * @throws CraftApiError on failure (e.g., 404 if not found)
   */
  async getDeploymentHealth(deploymentId: string): Promise<DeploymentHealth> {
    return this.request<DeploymentHealth>('GET', `/api/deployments/${deploymentId}/health`);
  }
}
