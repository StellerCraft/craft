import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { Navbar } from '@/components/marketing/Navbar';
import { Footer } from '@/components/marketing/Footer';
import PricingClient from './PricingClient';
import type { SubscriptionTier } from '@craft/types';

export const metadata: Metadata = {
  title: 'Pricing – CRAFT',
  description: 'Simple, transparent pricing for building and deploying DeFi on Stellar. Start free, scale when ready.',
};

const FOOTER_SECTIONS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '/#features' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Templates', href: '/app/templates' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Blog', href: '/blog' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
];

export default async function PricingPage() {
  // Attempt to read the current user's session server-side.
  // Gracefully falls back to logged-out state on any error.
  let isLoggedIn = false;
  let currentTier: SubscriptionTier | null = null;

  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      isLoggedIn = true;
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_tier')
        .eq('id', user.id)
        .single();
      currentTier = (profile?.subscription_tier as SubscriptionTier) ?? 'free';
    }
  } catch {
    // Non-fatal — render as logged-out
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar
        links={[
          { label: 'Features', href: '/#features' },
          { label: 'Pricing', href: '/pricing' },
          { label: 'Templates', href: '/app/templates' },
        ]}
        onLoginClick={undefined}
        onCtaClick={undefined}
      />

      <main className="flex-1 pt-16">
        <PricingClient isLoggedIn={isLoggedIn} currentTier={currentTier} />
      </main>

      <Footer sections={FOOTER_SECTIONS} />
    </div>
  );
}
