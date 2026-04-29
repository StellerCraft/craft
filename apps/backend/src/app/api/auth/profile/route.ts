import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { authService } from '@/services/auth.service';
import { resolveIpAddress } from '@/lib/api/logger';

const profileUpdateSchema = z.object({
    fullName: z.string().min(1).max(100).optional(),
    avatarUrl: z.string().url().optional(),
    email: z.string().email().optional(),
}).strict();

export const GET = withAuth(async (req: NextRequest, { user, log }) => {
    const ipAddress = resolveIpAddress(req);

    // Emit audit log for PII read (email field)
    log.audit({
        userId: user.id,
        action: 'profile.read',
        resourceId: user.id,
        resourceType: 'profile',
        ipAddress,
        metadata: {
            fields: ['email'],
        },
    });

    try {
        const profile = await authService.getCurrentUser();
        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }
        return NextResponse.json(profile);
    } catch (error: any) {
        log.error('Error reading profile', error);
        return NextResponse.json(
            { error: error.message || 'Failed to read profile' },
            { status: 500 }
        );
    }
});

export const PATCH = withAuth(async (req: NextRequest, { user, log }) => {
    const ipAddress = resolveIpAddress(req);
    const body = await req.json();
    const parsed = profileUpdateSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    if (Object.keys(parsed.data).length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Emit audit log for PII write (email field if present)
    const updatedFields = Object.keys(parsed.data);
    const piiFields = updatedFields.filter(field => field === 'email');
    
    if (piiFields.length > 0) {
        log.audit({
            userId: user.id,
            action: 'profile.write',
            resourceId: user.id,
            resourceType: 'profile',
            ipAddress,
            metadata: {
                fields: piiFields,
            },
        });
    }

    try {
        const updated = await authService.updateProfile(user.id, parsed.data);
        return NextResponse.json(updated);
    } catch (error: any) {
        log.error('Error updating profile', error);
        return NextResponse.json(
            { error: error.message || 'Failed to update profile' },
            { status: 500 }
        );
    }
});
