'use server';

import { profileSchema, type ProfileState } from '../settings/profile/actions';

/**
 * Server Action: completes onboarding by saving the initial profile.
 * Validates with the same profileSchema used in profile settings.
 * On success, the client redirects to /app.
 */
export async function completeOnboardingAction(
    _prev: ProfileState,
    formData: FormData,
): Promise<ProfileState> {
    const raw = {
        displayName: formData.get('displayName') as string,
        bio: (formData.get('bio') as string) ?? '',
        avatarUrl: (formData.get('avatarUrl') as string) ?? '',
        website: (formData.get('website') as string) ?? '',
        connectionStatus: (formData.get('connectionStatus') as string) ?? 'online',
    };

    const parsed = profileSchema.safeParse(raw);
    if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
            const key = issue.path[0] as string;
            if (!fieldErrors[key]) fieldErrors[key] = issue.message;
        }
        return { status: 'error', message: 'Please fix the errors below.', fieldErrors };
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
        return { status: 'success', message: 'Profile saved! Welcome to CRAFT.' };
    }

    const body = await res.json().catch(() => ({}));
    return {
        status: 'error',
        message: body.error ?? 'Something went wrong. Please try again.',
    };
}
