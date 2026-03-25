import React from 'react';

interface HeroProps {
  badge?: string;
  title: string | React.ReactNode;
  subtitle: string;
  ctaPrimary: string;
  ctaSecondary?: string;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
  image?: React.ReactNode;
}

export function Hero({
  badge,
  title,
  subtitle,
  ctaPrimary,
  ctaSecondary,
  onPrimaryClick,
  onSecondaryClick,
  image,
}: HeroProps) {
  return (
    <section className="relative overflow-hidden pt-24 pb-32">
      <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center">
        <div className="z-10">
          {badge && (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary-fixed text-on-secondary-fixed text-xs font-bold mb-6">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
              </svg>
              {badge}
            </div>
          )}
          
          <h1 className="text-5xl md:text-7xl font-extrabold font-headline leading-[1.1] tracking-tight text-primary mb-6">
            {title}
          </h1>
          
          <p className="text-lg text-on-secondary-container max-w-lg mb-10 leading-relaxed">
            {subtitle}
          </p>
          
          <div className="flex flex-wrap gap-4">
            <button 
              onClick={onPrimaryClick}
              className="primary-gradient text-on-primary px-8 py-4 rounded-xl font-bold text-lg flex items-center gap-2 shadow-xl hover:shadow-primary-container/20 transition-all active:scale-95"
            >
              {ctaPrimary}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
            
            {ctaSecondary && (
              <button 
                onClick={onSecondaryClick}
                className="bg-surface-container-lowest text-primary px-8 py-4 rounded-xl font-bold text-lg border border-outline-variant/20 shadow-sm hover:bg-surface-container-low transition-all active:scale-95"
              >
                {ctaSecondary}
              </button>
            )}
          </div>
        </div>
        
        {image && (
          <div className="relative lg:ml-12">
            <div className="relative z-10 rounded-2xl overflow-hidden shadow-2xl border border-outline-variant/10">
              {image}
            </div>
            {/* Asymmetric Decorative Elements */}
            <div className="absolute -top-12 -right-12 w-64 h-64 bg-tertiary-fixed-dim/20 blur-[100px] -z-0"></div>
            <div className="absolute -bottom-12 -left-12 w-72 h-72 bg-on-primary-container/10 blur-[120px] -z-0"></div>
          </div>
        )}
      </div>
    </section>
  );
}
