'use client';

import { Navbar } from '@/components/marketing/Navbar';
import { Hero } from '@/components/marketing/Hero';
import { Footer } from '@/components/marketing/Footer';
import Image from 'next/image';

export default function LandingPage() {
  return (
    <main className="min-h-screen pt-16">
      {/* Navigation */}
      <Navbar
        onLoginClick={() => console.log('Login clicked')}
        onCtaClick={() => console.log('Start building clicked')}
      />

      {/* Hero Section */}
      <Hero
        badge="BUILD SMARTER ON STELLAR"
        title={
          <>
            Build & Deploy DeFi on Stellar in <span className="text-on-primary-container">Minutes</span>, Not Months.
          </>
        }
        subtitle="The Customizable Rapid Application Framework for Trading. No-code logic meets production-ready security for the next generation of financial apps."
        ctaPrimary="Start Building"
        ctaSecondary="View Templates"
        onPrimaryClick={() => console.log('Start building')}
        onSecondaryClick={() => console.log('View templates')}
        image={
          <img 
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuAAdQsLt4LU7iqufhZPUeXfpo3LiDFKBEfxPWRb0vMaG6ujZjU17D4HALDFvWZY_fpII9YGotWKoNObPBkL19aDyIZSyvg3SB1ImcEP4pG-WoB0a-z-VcVMJbFY2r99FV1r9BZg7lg70m1HgmaEaiq991Zv7o4qiOHXDNA-BM5k7kSzaY4q2UmByMOk-TbAM0oV5mgrXyWdugGg9SW5Srgctp7Z2YsRfuIy0cJquvlqULz5iQEXPIW9EJ7-QErZl7HsiJygY6fMTVc"
            alt="clean high-fidelity web app dashboard with financial charts dark blue accents and elegant user interface design"
            className="w-full"
          />
        }
      />

      {/* Social Proof */}
      <section className="py-12 bg-surface-container-low">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-xs font-bold tracking-[0.2em] text-on-secondary-container/60 mb-10">
            TRUSTED BY INDUSTRY LEADERS
          </p>
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-20 opacity-60 grayscale">
            <span className="text-2xl font-bold text-primary font-headline">STELLAR</span>
            <span className="text-2xl font-bold text-primary font-headline">VERCEL</span>
            <span className="text-2xl font-bold text-primary font-headline">SUPABASE</span>
            <span className="text-2xl font-bold text-primary font-headline">STRIPE</span>
          </div>
        </div>
      </section>

      {/* Features Bento Grid */}
      <section className="py-32 bg-surface">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-20">
            <h2 className="text-4xl font-extrabold font-headline mb-4">Precision Engineering</h2>
            <p className="text-on-secondary-container max-w-xl">
              Every component is audited and optimized for the Stellar network, giving you the power of a custom build without the complexity.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-6">
            {/* Feature 1 - Visual Customization */}
            <div className="md:col-span-3 lg:col-span-8 bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant/10 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-on-primary-container/10 rounded-lg flex items-center justify-center text-on-primary-container mb-6">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold font-headline mb-3">Visual Customization Engine</h3>
              <p className="text-on-secondary-container mb-8 max-w-md">
                Inject your brand DNA. Adjust logo, color palettes, and component shapes in real-time with our reactive design studio.
              </p>
              <img 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuC2UbFw4JhNeXzNPOE1_5X1ANqecETnPGroHVnGhqKBDPLWw0UG_WM_1VL59lI0M5-KUr8WxXJkKfwymY6scxOxxOI9Cdz2SZP7_f4YRiMK8g-h27C96-kY7z--mLKUqqb0ZghZ_9HVMUipHsSVfkIZLZ4QANCuvP1Nl2215k7rGfNS2_t_wSvRQaPPVLd2wlpOkQ7nyKNN-FHCd6I-kv0YRcFtu5MN1ugDR3JohCUJpLgnUEkUTned3eFUhIcaJTA7rqkM9U6Rhig"
                alt="close-up of a visual UI editor showing color pickers and typography settings"
                className="rounded-xl border border-outline-variant/10 mt-4"
              />
            </div>

            {/* Feature 2 - Stellar Integration */}
            <div className="md:col-span-3 lg:col-span-4 bg-primary p-8 rounded-2xl text-on-primary shadow-xl flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 bg-on-primary-fixed/20 rounded-lg flex items-center justify-center text-tertiary-fixed-dim mb-6">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold font-headline mb-3">Stellar Integration</h3>
                <p className="text-primary-fixed/70 text-sm leading-relaxed">
                  Native support for Soroban smart contracts, automated asset issuance, and seamless wallet connectivity via Albedo and Freighter.
                </p>
              </div>
              <div className="mt-8 pt-8 border-t border-on-primary/10">
                <div className="flex items-center gap-2 text-tertiary-fixed-dim font-bold text-xs tracking-widest">
                  <span>PROTOCOL OPTIMIZED</span>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Feature 3 - Automated Deployment */}
            <div className="md:col-span-3 lg:col-span-5 bg-surface-container-high p-8 rounded-2xl flex flex-col justify-between">
              <div>
                <div className="w-12 h-12 bg-surface-container-lowest rounded-lg flex items-center justify-center text-primary mb-6 shadow-sm">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold font-headline mb-3">Automated Deployment</h3>
                <p className="text-on-secondary-container">
                  One-click Vercel & GitHub integration. Continuous delivery pipeline pre-configured for security and speed.
                </p>
              </div>
              <div className="bg-primary/5 rounded-xl p-4 mt-8 font-mono text-xs text-on-secondary-container">
                $ craft deploy --production
              </div>
            </div>

            {/* Feature 4 - Analytics */}
            <div className="md:col-span-3 lg:col-span-7 bg-surface-container-low p-8 rounded-2xl border border-outline-variant/10 shadow-sm">
              <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="flex-1">
                  <div className="w-12 h-12 bg-on-tertiary-container/10 rounded-lg flex items-center justify-center text-on-tertiary-container mb-6">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold font-headline mb-3">Subscription & Analytics</h3>
                  <p className="text-on-secondary-container">
                    Built-in monetization modules and performance tracking. Monitor TVL, volume, and active users in one unified dashboard.
                  </p>
                </div>
                <div className="w-full md:w-1/2 bg-surface-container-lowest p-4 rounded-xl shadow-sm">
                  <div className="h-32 bg-surface-container-low rounded-lg flex items-end p-2 gap-1">
                    <div className="bg-on-primary-container w-full h-[40%] rounded-t-sm"></div>
                    <div className="bg-on-primary-container w-full h-[70%] rounded-t-sm"></div>
                    <div className="bg-on-primary-container w-full h-[55%] rounded-t-sm"></div>
                    <div className="bg-on-primary-container w-full h-[90%] rounded-t-sm"></div>
                    <div className="bg-tertiary-fixed-dim w-full h-[65%] rounded-t-sm"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section className="py-24 bg-primary relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="text-tertiary-fixed-dim font-bold text-xs tracking-widest mb-4 block">
                ZERO-TRUST ARCHITECTURE
              </span>
              <h2 className="text-4xl md:text-5xl font-extrabold font-headline text-on-primary mb-8 leading-tight">
                Enterprise-Grade Security by Default.
              </h2>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="text-tertiary-fixed-dim mt-1">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-on-primary font-bold text-lg">Row-Level Security (RLS)</h4>
                    <p className="text-primary-fixed/60">
                      Strict data isolation policies ensure users only ever interact with their own assets.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="text-tertiary-fixed-dim mt-1">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-on-primary font-bold text-lg">Encrypted Secrets</h4>
                    <p className="text-primary-fixed/60">
                      Vault-level encryption for all API keys and sensitive configuration parameters.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="text-tertiary-fixed-dim mt-1">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-on-primary font-bold text-lg">CSRF & XSS Protection</h4>
                    <p className="text-primary-fixed/60">
                      Built-in middleware protecting your frontend and backend from common vulnerabilities.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden lg:block">
              <img 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuC7tkSLgIbxry9gCwFm0IHR5VPakhLwGUaf6mFbGzPTqk653HeWBTn9FIv6wRI20alkzd-gwPmjs0wOO7aL_DsmIDYoHWXiqCGWEqWFUkvFiWKKeggscKbRk0uCfqk0DaIbNDnWsAkskyaH8pWwOq_DSjuLpxQAY4ovTAjXgenmPr7CuSt8mfXkE5vpzdh2nPVmFPWXhFYC_nIZJd1RocjHKhJJJzh3dunf3Gciq8n63XVur4sHjtKXTevdfbZ-0SNWQ-ynx91UnDs"
                alt="abstract digital shield with glowing blue lines and hexagonal patterns"
                className="rounded-2xl opacity-80 mix-blend-screen"
              />
            </div>
          </div>
        </div>
        {/* Background Texture */}
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div 
            className="absolute top-0 left-0 w-full h-full" 
            style={{
              backgroundImage: 'radial-gradient(circle at 2px 2px, #fff 1px, transparent 0)',
              backgroundSize: '40px 40px'
            }}
          ></div>
        </div>
      </section>

      {/* Footer */}
      <Footer
        sections={[
          {
            title: 'Products',
            links: [
              { label: 'Framework', href: '#' },
              { label: 'Templates', href: '#' },
              { label: 'API Reference', href: '#' },
            ],
          },
          {
            title: 'Features',
            links: [
              { label: 'Stellar Nodes', href: '#' },
              { label: 'Security RLS', href: '#' },
              { label: 'Analytics', href: '#' },
            ],
          },
          {
            title: 'Company',
            links: [
              { label: 'Documentation', href: '#' },
              { label: 'Privacy Policy', href: '#' },
              { label: 'Terms of Service', href: '#' },
            ],
          },
          {
            title: 'Connect',
            links: [
              { label: 'Twitter', href: '#' },
              { label: 'GitHub', href: '#' },
              { label: 'LinkedIn', href: '#' },
            ],
          },
        ]}
      />
    </main>
  );
}
