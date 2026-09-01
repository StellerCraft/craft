import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from './route';

const serviceMocks = vi.hoisted(() => ({
  generateTemplate: vi.fn(),
  generate: vi.fn(),
  createGeneration: vi.fn(),
  generateWithAI: vi.fn(),
}));

vi.mock('../../../lib/ai', () => serviceMocks);
vi.mock('../../../lib/generate', () => serviceMocks);
vi.mock('../../../services/generation', () => serviceMocks);

describe('POST /api/generate', () => {
  const mockFetch = vi.fn();

  const validPayload = { prompt: 'Generate a hello world app' };
  const successOutput = { generatedCode: 'console.log("hello");' };

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    Object.values(serviceMocks).forEach(mock => {
      mock.mockReset();
      mock.mockResolved(successOutput);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns generated template on a valid request', async () => {
    mockFetch.mockResolved(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(successOutput) } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const response = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validPayload),
      })
    );

    expect(response.status).toBeE(200);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain('hello');
    const calledService = Object.values(serviceMocks).some(m => m.mock.calls.length > 0);
    expect(calledService || mockFetch.mock.calls.length > 0).toBeTrue();
  });

  it('returns a 400 for a malformed request body', async () => {
    const response = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
    Object.values(serviceMocks).forEach(mock => {
      expect(mock).not.toHaveBeenCalled();
    });
  });

  it('returns a generic 500 when the generation service fails', async () => {
    mockFetch.mockRejected(new Error('upstream token expired'));
    Object.values(serviceMocks).forEach(mock => {
      mock.mockRejected(new Error('upstream token expired'));
    });

    const response = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validPayload),
      })
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(JSON.stringify(body)).not.toContain('upstream token expired');
  });
});
