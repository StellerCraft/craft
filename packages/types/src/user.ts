export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export interface User {
    id: string;
    email: string;
    createdAt: Date;
    subscriptionTier: SubscriptionTier;
    githubConnected: boolean;
    githubUsername: string | null;
}

export interface AuthResult {
    user: User | null;
    session: Session | null;
    error: AuthError | null;
}

export interface Session {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}

export interface AuthError {
    code: string;
    message: string;
}

export interface ProfileUpdate {
    email?: string;
    fullName?: string;
    avatarUrl?: string;
}
