'use server';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export interface ProfileState {
    status: 'idle' | 'success' | 'error';
    message: string;
    fieldErrors?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
    displayName: z
        .string({ required_error: 'Display name is required.' })
        .trim()
        .min(2, 'Display name must be at least 2 characters.'),
    bio: z
        .string()
        .max(160, 'Bio must be 160 characters or fewer.')
        .optional()
        .default(''),
    avatarUrl: z
        .string()
        .url('Avatar URL must be a valid URL.')
        .optional()
        .or(z.literal('')),
});

// ---------------------------------------------------------------------------
// Server Action: Fetch profile
// ---------------------------------------------------------------------------

/**
 * Fetches the current user profile from GET /api/profile.
 * Returns a ProfileState with `data` merged into the message on success,
 * or an error state on failure.
 */
export async function fetchProfileAction(): Promise<
    ProfileState & { data?: Record<string, string> }
> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    let res: Response;
    try {
        res = await fetch(`${baseUrl}/api/profile`, { method: 'GET' });
    } catch {
        return { status: 'error', message: 'Network error. Please try again.' };
    }

    if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { status: 'success', message: '', data };
    }

    const body = await res.json().catch(() => ({}));
    return {
        status: 'error',
        message: body.error ?? 'Failed to load profile. Please try again.',
    };
}

// ---------------------------------------------------------------------------
// Server Action: Update profile
// ---------------------------------------------------------------------------

/**
 * Server Action: validates form data with Zod then calls PUT /api/profile.
 * Returns a serialisable state object consumed by the ProfileSettingsForm
 * client component.
 *
 * Error copy mapping:
 *  - Zod validation → field-level errors in `fieldErrors`
 *  - Network error  → "Network error. Please try again."
 *  - Non-200 API    → API message or generic fallback
 *  - 200            → "Profile updated successfully."
 */
export async function updateProfileAction(
    _prev: ProfileState,
    formData: FormData,
): Promise<ProfileState> {
    const raw = {
        displayName: formData.get('displayName') as string,
        bio: (formData.get('bio') as string) ?? '',
        avatarUrl: (formData.get('avatarUrl') as string) ?? '',
    };

    // Zod validation
    const parsed = profileSchema.safeParse(raw);
    if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
            const key = issue.path[0] as string;
            if (!fieldErrors[key]) {
                fieldErrors[key] = issue.message;
            }
        }
        return {
            status: 'error',
            message: 'Please fix the errors below.',
            fieldErrors,
        };
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    let res: Response;
    try {
        res = await fetch(`${baseUrl}/api/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed.data),
        });
    } catch {
        return { status: 'error', message: 'Network error. Please try again.' };
    }

    if (res.ok) {
        return { status: 'success', message: 'Profile updated successfully.' };
    }

    const body = await res.json().catch(() => ({}));
    return {
        status: 'error',
        message: body.error ?? 'Something went wrong. Please try again.',
    };
}
