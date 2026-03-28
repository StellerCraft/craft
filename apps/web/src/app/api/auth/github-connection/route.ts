/**
 * PATCH /api/auth/github-connection
 *
 * Sets or clears the GitHub connection on the authenticated user's profile.
 *
 * Connect:   { "connected": true,  "username": "octocat" }
 * Disconnect:{ "connected": false }
 *
 * Only the server should call this — the client never writes github_connected
 * directly. The route is intentionally separate from PATCH /api/auth/profile
 * so the connection state change is explicit and auditable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';

const schema = z.discriminatedUnion('connected', [
    z.object({ connected: z.literal(true), username: z.string().min(1).max(39) }),
    z.object({ connected: z.literal(false) }),
]);

export const PATCH = withAuth(async (req: NextRequest, { user, supabase }) => {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
            { status: 400 },
        );
    }

    const update = parsed.data.connected
        ? { github_connected: true, github_username: parsed.data.username }
        : { github_connected: false, github_username: null };

    const { error } = await supabase
        .from('profiles')
        .update(update)
        .eq('id', user.id);

    if (error) {
        return NextResponse.json({ error: 'Failed to update GitHub connection' }, { status: 500 });
    }

    return NextResponse.json({
        githubConnected: update.github_connected,
        githubUsername: 'github_username' in update ? update.github_username : null,
    });
});
