'use server';

export interface SignUpState {
    status: 'idle' | 'success' | 'error';
    message: string;
}

/**
 * Server Action: calls POST /api/auth/signup.
 * Returns a serialisable state object consumed by the SignUpForm client component.
 */
export async function signUpAction(
    _prev: SignUpState,
    formData: FormData
): Promise<SignUpState> {
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (password !== confirmPassword) {
        return { status: 'error', message: 'Passwords do not match.' };
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    let res: Response;
    try {
        res = await fetch(`${baseUrl}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
    } catch {
        return { status: 'error', message: 'Network error. Please try again.' };
    }

    if (res.ok) {
        return { status: 'success', message: 'Account created! Check your email to confirm.' };
    }

    const body = await res.json().catch(() => ({}));
    const message =
        res.status === 409
            ? 'An account with this email already exists.'
            : body.error ?? 'Something went wrong. Please try again.';

    return { status: 'error', message };
}
