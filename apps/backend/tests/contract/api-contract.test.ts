import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Contract Tests for API Endpoints
 * 
 * Ensures API endpoints maintain backward compatibility and adhere to documented schemas.
 * Tests API versioning, deprecation handling, and breaking change detection.
 */

interface SchemaProperty {
  type: string;
  required?: boolean;
  enum?: string[];
  format?: string;
  minLength?: number;
  items?: SchemaProperty;
}

interface APISchema {
  [key: string]: SchemaProperty;
}

interface APIContract {
  endpoint: string;
  method: string;
  version: string;
  requestSchema: APISchema;
  responseSchema: APISchema;
  deprecated?: boolean;
  deprecatedSince?: string;
  replacedBy?: string;
}

class SchemaValidator {
  validate(data: unknown, schema: APISchema): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (typeof data !== 'object' || data === null) {
      return { valid: false, errors: ['Data must be an object'] };
    }

    const obj = data as Record<string, unknown>;

    for (const [key, property] of Object.entries(schema)) {
      const value = obj[key];

      if (property.required && value === undefined) {
        errors.push(`Missing required field: ${key}`);
        continue;
      }

      if (value !== undefined) {
        if (property.type === 'string' && typeof value !== 'string') {
          errors.push(`Field ${key} must be a string, got ${typeof value}`);
        }

        if (property.type === 'number' && typeof value !== 'number') {
          errors.push(`Field ${key} must be a number, got ${typeof value}`);
        }

        if (property.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Field ${key} must be a boolean, got ${typeof value}`);
        }

        if (property.enum && !property.enum.includes(String(value))) {
          errors.push(`Field ${key} must be one of: ${property.enum.join(', ')}`);
        }

        if (property.minLength && typeof value === 'string' && value.length < property.minLength) {
          errors.push(`Field ${key} must be at least ${property.minLength} characters`);
        }

        if (property.type === 'array' && !Array.isArray(value)) {
          errors.push(`Field ${key} must be an array`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

class ContractTester {
  private contracts: Map<string, APIContract> = new Map();
  private schemaValidator = new SchemaValidator();

  registerContract(contract: APIContract): void {
    const key = `${contract.method} ${contract.endpoint} v${contract.version}`;
    this.contracts.set(key, contract);
  }

  validateRequest(
    endpoint: string,
    method: string,
    version: string,
    data: unknown
  ): { valid: boolean; errors: string[] } {
    const key = `${method} ${endpoint} v${version}`;
    const contract = this.contracts.get(key);

    if (!contract) {
      return { valid: false, errors: [`No contract found for ${key}`] };
    }

    return this.schemaValidator.validate(data, contract.requestSchema);
  }

  validateResponse(
    endpoint: string,
    method: string,
    version: string,
    data: unknown
  ): { valid: boolean; errors: string[] } {
    const key = `${method} ${endpoint} v${version}`;
    const contract = this.contracts.get(key);

    if (!contract) {
      return { valid: false, errors: [`No contract found for ${key}`] };
    }

    return this.schemaValidator.validate(data, contract.responseSchema);
  }

  isDeprecated(endpoint: string, method: string, version: string): boolean {
    const key = `${method} ${endpoint} v${version}`;
    const contract = this.contracts.get(key);
    return contract?.deprecated ?? false;
  }

  getReplacementEndpoint(endpoint: string, method: string, version: string): string | undefined {
    const key = `${method} ${endpoint} v${version}`;
    const contract = this.contracts.get(key);
    return contract?.replacedBy;
  }

  detectBreakingChanges(oldContract: APIContract, newContract: APIContract): string[] {
    const changes: string[] = [];

    // Check for removed required fields
    for (const [key, property] of Object.entries(oldContract.responseSchema)) {
      if (property.required && !(key in newContract.responseSchema)) {
        changes.push(`Breaking change: Required response field '${key}' was removed`);
      }
    }

    // Check for changed field types
    for (const [key, oldProperty] of Object.entries(oldContract.responseSchema)) {
      const newProperty = newContract.responseSchema[key];
      if (newProperty && oldProperty.type !== newProperty.type) {
        changes.push(`Breaking change: Response field '${key}' type changed from ${oldProperty.type} to ${newProperty.type}`);
      }
    }

    // Check for removed enum values
    for (const [key, oldProperty] of Object.entries(oldContract.responseSchema)) {
      const newProperty = newContract.responseSchema[key];
      if (oldProperty.enum && newProperty?.enum) {
        const removedValues = oldProperty.enum.filter(v => !newProperty.enum!.includes(v));
        if (removedValues.length > 0) {
          changes.push(`Breaking change: Enum values removed from '${key}': ${removedValues.join(', ')}`);
        }
      }
    }

    return changes;
  }
}

describe('Contract Tests: API Endpoints', () => {
  let contractTester: ContractTester;

  beforeEach(() => {
    contractTester = new ContractTester();
  });

  describe('Authentication Endpoints', () => {
    beforeEach(() => {
      contractTester.registerContract({
        endpoint: '/auth/signup',
        method: 'POST',
        version: '1.0',
        requestSchema: {
          email: { type: 'string', required: true, format: 'email' },
          password: { type: 'string', required: true, minLength: 8 },
          fullName: { type: 'string', required: true },
        },
        responseSchema: {
          user: { type: 'object', required: true },
          session: { type: 'object', required: true },
        },
      });

      contractTester.registerContract({
        endpoint: '/auth/signin',
        method: 'POST',
        version: '1.0',
        requestSchema: {
          email: { type: 'string', required: true },
          password: { type: 'string', required: true },
        },
        responseSchema: {
          user: { type: 'object', required: true },
          session: { type: 'object', required: true },
        },
      });
    });

    it('should validate signup request schema', () => {
      const validRequest = {
        email: 'user@example.com',
        password: 'securePassword123',
        fullName: 'John Doe',
      };

      const result = contractTester.validateRequest('/auth/signup', 'POST', '1.0', validRequest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject signup request with missing required fields', () => {
      const invalidRequest = {
        email: 'user@example.com',
        // missing password and fullName
      };

      const result = contractTester.validateRequest('/auth/signup', 'POST', '1.0', invalidRequest);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject signup request with short password', () => {
      const invalidRequest = {
        email: 'user@example.com',
        password: 'short',
        fullName: 'John Doe',
      };

      const result = contractTester.validateRequest('/auth/signup', 'POST', '1.0', invalidRequest);
      expect(result.valid).toBe(false);
    });

    it('should validate signin response schema', () => {
      const validResponse = {
        user: { id: 'uuid', email: 'user@example.com' },
        session: { access_token: 'jwt_token', refresh_token: 'refresh_token' },
      };

      const result = contractTester.validateResponse('/auth/signin', 'POST', '1.0', validResponse);
      expect(result.valid).toBe(true);
    });

    it('should reject response with missing required fields', () => {
      const invalidResponse = {
        user: { id: 'uuid', email: 'user@example.com' },
        // missing session
      };

      const result = contractTester.validateResponse('/auth/signin', 'POST', '1.0', invalidResponse);
      expect(result.valid).toBe(false);
    });
  });

  describe('Template Endpoints', () => {
    beforeEach(() => {
      contractTester.registerContract({
        endpoint: '/templates',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          templates: { type: 'array', required: true },
          total: { type: 'number', required: true },
          limit: { type: 'number', required: true },
          offset: { type: 'number', required: true },
        },
      });

      contractTester.registerContract({
        endpoint: '/templates/{id}',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          category: { type: 'string', required: true, enum: ['dex', 'defi', 'payment', 'asset'] },
          version: { type: 'string', required: true },
        },
      });
    });

    it('should validate templates list response schema', () => {
      const validResponse = {
        templates: [
          { id: 'uuid1', name: 'Stellar DEX', category: 'dex' },
          { id: 'uuid2', name: 'Payment Gateway', category: 'payment' },
        ],
        total: 4,
        limit: 10,
        offset: 0,
      };

      const result = contractTester.validateResponse('/templates', 'GET', '1.0', validResponse);
      expect(result.valid).toBe(true);
    });

    it('should validate template detail response schema', () => {
      const validResponse = {
        id: 'uuid',
        name: 'Stellar DEX',
        category: 'dex',
        version: '1.0.0',
      };

      const result = contractTester.validateResponse('/templates/{id}', 'GET', '1.0', validResponse);
      expect(result.valid).toBe(true);
    });

    it('should reject response with invalid enum value', () => {
      const invalidResponse = {
        id: 'uuid',
        name: 'Stellar DEX',
        category: 'invalid-category',
        version: '1.0.0',
      };

      const result = contractTester.validateResponse('/templates/{id}', 'GET', '1.0', invalidResponse);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('enum'))).toBe(true);
    });
  });

  describe('Deployment Endpoints', () => {
    beforeEach(() => {
      contractTester.registerContract({
        endpoint: '/deployments/{id}/analytics',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          analytics: { type: 'array', required: true },
          summary: { type: 'object', required: true },
        },
      });
    });

    it('should validate analytics response schema', () => {
      const validResponse = {
        analytics: [
          { id: 'uuid', metricType: 'page_view', metricValue: 150, recordedAt: '2024-01-15T10:30:00Z' },
        ],
        summary: {
          totalPageViews: 1500,
          uptimePercentage: 99.9,
          totalTransactions: 250,
          lastChecked: '2024-01-15T12:00:00Z',
        },
      };

      const result = contractTester.validateResponse('/deployments/{id}/analytics', 'GET', '1.0', validResponse);
      expect(result.valid).toBe(true);
    });
  });

  describe('API Versioning', () => {
    it('should support multiple API versions', () => {
      contractTester.registerContract({
        endpoint: '/templates',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          templates: { type: 'array', required: true },
        },
      });

      contractTester.registerContract({
        endpoint: '/templates',
        method: 'GET',
        version: '2.0',
        requestSchema: {},
        responseSchema: {
          data: { type: 'array', required: true },
          meta: { type: 'object', required: true },
        },
      });

      const v1Response = { templates: [] };
      const v2Response = { data: [], meta: {} };

      const v1Result = contractTester.validateResponse('/templates', 'GET', '1.0', v1Response);
      const v2Result = contractTester.validateResponse('/templates', 'GET', '2.0', v2Response);

      expect(v1Result.valid).toBe(true);
      expect(v2Result.valid).toBe(true);
    });

    it('should detect version mismatch', () => {
      contractTester.registerContract({
        endpoint: '/templates',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          templates: { type: 'array', required: true },
        },
      });

      const v2Response = { data: [], meta: {} };
      const result = contractTester.validateResponse('/templates', 'GET', '1.0', v2Response);

      expect(result.valid).toBe(false);
    });
  });

  describe('Deprecation Handling', () => {
    it('should mark endpoints as deprecated', () => {
      contractTester.registerContract({
        endpoint: '/auth/old-signin',
        method: 'POST',
        version: '1.0',
        requestSchema: {},
        responseSchema: {},
        deprecated: true,
        deprecatedSince: '1.5',
        replacedBy: '/auth/signin',
      });

      const isDeprecated = contractTester.isDeprecated('/auth/old-signin', 'POST', '1.0');
      expect(isDeprecated).toBe(true);
    });

    it('should provide replacement endpoint for deprecated endpoints', () => {
      contractTester.registerContract({
        endpoint: '/auth/old-signin',
        method: 'POST',
        version: '1.0',
        requestSchema: {},
        responseSchema: {},
        deprecated: true,
        replacedBy: '/auth/signin',
      });

      const replacement = contractTester.getReplacementEndpoint('/auth/old-signin', 'POST', '1.0');
      expect(replacement).toBe('/auth/signin');
    });
  });

  describe('Breaking Change Detection', () => {
    it('should detect removed required response fields', () => {
      const oldContract: APIContract = {
        endpoint: '/templates/{id}',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          description: { type: 'string', required: true },
        },
      };

      const newContract: APIContract = {
        endpoint: '/templates/{id}',
        method: 'GET',
        version: '2.0',
        requestSchema: {},
        responseSchema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          // description removed
        },
      };

      const changes = contractTester.detectBreakingChanges(oldContract, newContract);
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some(c => c.includes('description'))).toBe(true);
    });

    it('should detect field type changes', () => {
      const oldContract: APIContract = {
        endpoint: '/deployments',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          count: { type: 'number', required: true },
        },
      };

      const newContract: APIContract = {
        endpoint: '/deployments',
        method: 'GET',
        version: '2.0',
        requestSchema: {},
        responseSchema: {
          count: { type: 'string', required: true },
        },
      };

      const changes = contractTester.detectBreakingChanges(oldContract, newContract);
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some(c => c.includes('type changed'))).toBe(true);
    });

    it('should detect removed enum values', () => {
      const oldContract: APIContract = {
        endpoint: '/templates',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          category: { type: 'string', enum: ['dex', 'defi', 'payment', 'asset'] },
        },
      };

      const newContract: APIContract = {
        endpoint: '/templates',
        method: 'GET',
        version: '2.0',
        requestSchema: {},
        responseSchema: {
          category: { type: 'string', enum: ['dex', 'defi', 'payment'] },
        },
      };

      const changes = contractTester.detectBreakingChanges(oldContract, newContract);
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some(c => c.includes('Enum values removed'))).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain backward compatibility when adding optional fields', () => {
      const oldContract: APIContract = {
        endpoint: '/templates/{id}',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      };

      const newContract: APIContract = {
        endpoint: '/templates/{id}',
        method: 'GET',
        version: '1.1',
        requestSchema: {},
        responseSchema: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          description: { type: 'string', required: false },
        },
      };

      const changes = contractTester.detectBreakingChanges(oldContract, newContract);
      expect(changes.length).toBe(0);
    });

    it('should maintain backward compatibility when adding new enum values', () => {
      const oldContract: APIContract = {
        endpoint: '/templates',
        method: 'GET',
        version: '1.0',
        requestSchema: {},
        responseSchema: {
          category: { type: 'string', enum: ['dex', 'defi'] },
        },
      };

      const newContract: APIContract = {
        endpoint: '/templates',
        method: 'GET',
        version: '1.1',
        requestSchema: {},
        responseSchema: {
          category: { type: 'string', enum: ['dex', 'defi', 'payment', 'asset'] },
        },
      };

      const changes = contractTester.detectBreakingChanges(oldContract, newContract);
      expect(changes.length).toBe(0);
    });
  });

  describe('Error Response Contracts', () => {
    beforeEach(() => {
      contractTester.registerContract({
        endpoint: '/auth/signin',
        method: 'POST',
        version: '1.0',
        requestSchema: {
          email: { type: 'string', required: true },
          password: { type: 'string', required: true },
        },
        responseSchema: {
          message: { type: 'string', required: true },
          code: { type: 'string', required: true },
        },
      });
    });

    it('should validate error response schema', () => {
      const errorResponse = {
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
      };

      const result = contractTester.validateResponse('/auth/signin', 'POST', '1.0', errorResponse);
      expect(result.valid).toBe(true);
    });
  });
});
