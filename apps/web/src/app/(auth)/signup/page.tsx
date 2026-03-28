import type { Metadata } from 'next';
import SignUpForm from './SignUpForm';

export const metadata: Metadata = {
    title: 'Create account – CRAFT',
    description: 'Sign up for CRAFT and start deploying DeFi apps on Stellar.',
};

export default function SignUpPage() {
    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-2xl font-bold font-headline text-on-surface">
                    Create your account
                </h1>
                <p className="mt-1 text-sm text-on-surface-variant">
                    Deploy DeFi apps on Stellar in minutes.
                </p>
            </div>
            <SignUpForm />
        </div>
    );
}
