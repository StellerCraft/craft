import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getRateLimitKey, type RateLimitConfig } from './rate-limit';

type RouteHandler<TParams = {}> = (
  req: NextRequest,
  ctx: { params: TParams }
) => Promise<NextResponse>;

/**
 * Wraps a route handler with sliding-window rate limiting.
 *
 * When the limit is exceeded the handler is NOT called and a 429 response
 * is returned with:
 *   - Retry-After header (seconds)
 *   - X-RateLimit-* headers for client visibility
 *   - JSON body with retryAfterMs and resetAt for programmatic use
 *
 * Usage:
 *   export const POST = withRateLimit('auth:signin', AUTH_RATE_LIMIT)(handler);
 *
 * Bypass (local dev):
 *   Set RATE_LIMIT_DISABLED=true in .env.local
 */
export function withRateLimit<TParams = {}>(
  routeKey: string,
  config: RateLimitConfig
) {
  return (handler: RouteHandler<TParams>): RouteHandler<TParams> => {
    return async (req: NextRequest, ctx: { params: TParams }) => {
      // Allow bypass in local development / CI.
      if (process.env.RATE_LIMIT_DISABLED === 'true') {
        return handler(req, ctx);
      }

      const key = getRateLimitKey(req, routeKey);
      const result = checkRateLimit(key, config);

      const rateLimitHeaders = {
        'X-RateLimit-Limit': String(config.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
      };

      if (!result.allowed) {
        return NextResponse.json(
          {
            error: 'Too many requests. Please try again later.',
            retryAfterMs: result.retryAfterMs,
            resetAt: result.resetAt,
          },
          {
            status: 429,
            headers: {
              ...rateLimitHeaders,
              'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)),
            },
          }
        );
      }

      const response = await handler(req, ctx);

      // Attach rate-limit headers to successful responses too.
      Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v));

      return response;
    };
  };
}
