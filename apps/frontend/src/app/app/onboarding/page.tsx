/**
 * /app/onboarding — First-run profile setup page
 *
 * States:
 *  - Entry:      Form with displayName (required), bio, website, connectionStatus.
 *                Validation errors shown inline. Submit calls completeOnboardingAction.
 *  - Completion: Success checkmark + "Go to dashboard" link to /app.
 *
 * This page is shown once after a user signs up and before they access the main app.
 */
import OnboardingForm from './OnboardingForm';

export const metadata = {
    title: 'Welcome to CRAFT — Set up your profile',
};

export default function OnboardingPage() {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-primary">
                        <svg
                            className="h-6 w-6 text-on-primary"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                            />
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold font-headline text-on-surface">
                        Welcome to CRAFT
                    </h1>
                    <p className="mt-2 text-on-surface-variant">
                        Let&apos;s set up your profile to get started.
                    </p>
                </div>

                {/* Card */}
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 sm:p-8 shadow-sm">
                    <OnboardingForm />
                </div>

                <p className="mt-4 text-center text-xs text-on-surface-variant">
                    You can update these details later in{' '}
                    <a
                        href="/app/settings/profile"
                        className="font-medium text-surface-tint hover:underline focus:outline-none focus:ring-2 focus:ring-surface-tint rounded"
                    >
                        Profile Settings
                    </a>
                    .
                </p>
            </div>
        </div>
    );
}
