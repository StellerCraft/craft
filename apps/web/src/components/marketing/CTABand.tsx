import React from 'react';
import { Button } from './Button';

interface CTABandProps {
  title: string;
  description?: string;
  ctaText: string;
  onCtaClick?: () => void;
  variant?: 'light' | 'dark';
}

export function CTABand({ 
  title, 
  description, 
  ctaText, 
  onCtaClick,
  variant = 'dark'
}: CTABandProps) {
  const isDark = variant === 'dark';
  
  return (
    <section className={`${isDark ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface'} py-16 lg:py-24`}>
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h2 className="text-3xl lg:text-5xl font-display font-bold">
            {title}
          </h2>
          {description && (
            <p className={`text-lg lg:text-xl ${isDark ? 'text-on-primary/80' : 'text-on-surface-variant'}`}>
              {description}
            </p>
          )}
          <div className="pt-4">
            <Button 
              variant={isDark ? 'secondary' : 'primary'}
              size="lg"
              onClick={onCtaClick}
            >
              {ctaText}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
