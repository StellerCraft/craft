/**
 * Request validation middleware using Zod schemas (#230)
 *
 * Provides type-safe validation for Next.js API route inputs:
 *   - withValidation(schema)  — validates req.json() body
 *   - withQueryValidation(schema) — validates URL search params
 *   - withParamsValidation(schema) — validates route params
 *
 * On failure returns HTTP 400 with field-level errors:
 *   { error: 'Validation failed', details: { field: ['message'] } }
 *
 * Compose with withAuth / withRateLimit:
 *   export const POST = withRateLimit('route', config)(
 *     withValidation(schema)(handler)
 *   );
 */

import { NextRequest, NextResponse } from 'next/server';
import type { ZodSchema, ZodError } from 'zod';

type RouteHandler<TBody = unknown, TParams = {}> = (
    req: NextRequest & { validatedBody: TBody },
    ctx: { params: TParams },
) => Promise<NextResponse>;

type QueryHandler<TQuery = unknown, TParams = {}> = (
    req: NextRequest & { validatedQuery: TQuery },
    ctx: { params: TParams },
) => Promise<NextResponse>;

type ParamsHandler<TParams = {}> = (
    req: NextRequest,
    ctx: { params: TParams },
) => Promise<NextResponse>;

function formatErrors(err: ZodError): Record<string, string[]> {
    return err.flatten().fieldErrors as Record<string, string[]>;
}

/**
 * Validates the JSON request body against the given Zod schema.
 * Returns 400 with field-level errors if validation fails.
 * Attaches `req.validatedBody` for the inner handler.
 *
 * @example
 * ```typescript
 * const createDeploymentSchema = z.object({
 *   projectId: z.string().uuid(),
 *   branch: z.string().min(1),
 * });
 *
 * export const POST = withValidation(createDeploymentSchema)(async (req) => {
 *   const { projectId, branch } = req.validatedBody; // typed, already valid
 *   const deployment = await createDeployment(projectId, branch);
 *   return NextResponse.json(deployment, { status: 201 });
 * });
 * ```
 */
export function withValidation<TBody, TParams = {}>(schema: ZodSchema<TBody>) {
    return (handler: RouteHandler<TBody, TParams>) =>
        async (req: NextRequest, ctx: { params: TParams }): Promise<NextResponse> => {
            let raw: unknown;
            try {
                raw = await req.json();
            } catch {
                return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
            }

            const result = schema.safeParse(raw);
            if (!result.success) {
                return NextResponse.json(
                    { error: 'Validation failed', details: formatErrors(result.error) },
                    { status: 400 },
                );
            }

            (req as NextRequest & { validatedBody: TBody }).validatedBody = result.data;
            return handler(req as NextRequest & { validatedBody: TBody }, ctx);
        };
}

/**
 * Validates URL search params against the given Zod schema.
 * Returns 400 with field-level errors if validation fails.
 * Attaches `req.validatedQuery` for the inner handler.
 *
 * @example
 * ```typescript
 * const listDeploymentsQuerySchema = z.object({
 *   status: z.enum(['pending', 'live', 'failed']).optional(),
 *   limit: z.coerce.number().int().positive().max(100).default(20),
 * });
 *
 * export const GET = withQueryValidation(listDeploymentsQuerySchema)(async (req) => {
 *   const { status, limit } = req.validatedQuery; // typed, already valid
 *   const deployments = await listDeployments({ status, limit });
 *   return NextResponse.json(deployments);
 * });
 * ```
 */
export function withQueryValidation<TQuery, TParams = {}>(schema: ZodSchema<TQuery>) {
    return (handler: QueryHandler<TQuery, TParams>) =>
        async (req: NextRequest, ctx: { params: TParams }): Promise<NextResponse> => {
            const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
            const result = schema.safeParse(raw);
            if (!result.success) {
                return NextResponse.json(
                    { error: 'Validation failed', details: formatErrors(result.error) },
                    { status: 400 },
                );
            }

            (req as NextRequest & { validatedQuery: TQuery }).validatedQuery = result.data;
            return handler(req as NextRequest & { validatedQuery: TQuery }, ctx);
        };
}

/**
 * Validates route params against the given Zod schema.
 * Returns 400 with field-level errors if validation fails.
 *
 * @example
 * ```typescript
 * const paramsSchema = z.object({ deploymentId: z.string().uuid() });
 *
 * export const DELETE = withParamsValidation(paramsSchema)(async (req, ctx) => {
 *   const { deploymentId } = ctx.params; // typed, already valid
 *   await deleteDeployment(deploymentId);
 *   return NextResponse.json({ deleted: true });
 * });
 * ```
 */
export function withParamsValidation<TParams extends Record<string, unknown>>(
    schema: ZodSchema<TParams>,
) {
    return (handler: ParamsHandler<TParams>) =>
        async (req: NextRequest, ctx: { params: TParams }): Promise<NextResponse> => {
            const result = schema.safeParse(ctx.params);
            if (!result.success) {
                return NextResponse.json(
                    { error: 'Validation failed', details: formatErrors(result.error) },
                    { status: 400 },
                );
            }

            return handler(req, { params: result.data });
        };
}
