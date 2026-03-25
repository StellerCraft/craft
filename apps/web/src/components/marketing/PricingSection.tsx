import React from 'react';
import { Button } from './Button';

interface PricingTier {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  isPrimary?: boolean;
  ctaText: string;
  onCtaClick?: () => void;
}

interface PricingSectionProps {
  title: string;
  subtitle?: string;
  tiers: PricingTier[];
}

export function PricingSection({ 
  title, 
  subtitle, 
  tiers 
}: PricingSectionProps) {
  return (
    <section className="bg-surface py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-4xl lg:text-5xl font-display font-bold text-on-surface">
            {title}
          </h2>
          {subtitle && (
            <p className="text-lg text-on-surface-variant max-w-3xl mx-auto">
              {subtitle}
            </p>
          )}
        </div>
        
        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {tiers.map((tier, index) => (
            <div 
              key={index}
              className={`bg-surface-container-lowest rounded-lg p-8 space-y-6 ambient-shadow ${
                tier.isPrimary ? 'border-t-2 border-surface-tint' : ''
              }`}
            >
              <div className="space-y-2">
                <h3 className="text-2xl font-display font-bold text-on-surface">
                  {tier.name}
                </h3>
                <p className="text-on-surface-variant text-sm">
                  {tier.description}
                </p>
              </div>
              
              <div className="space-y-1">
                <div className="text-5xl font-display font-bold text-on-surface">
                  {tier.price}
                </div>
                {tier.period && (
                  <div className="text-on-surface-variant text-sm">
                    {tier.period}
                  </div>
                )}
              </div>
              
              <Button 
                variant={tier.isPrimary ? 'primary' : 'secondary'}
                className="w-full"
                onClick={tier.onCtaClick}
              >
                {tier.ctaText}
              </Button>
              
              <ul className="space-y-3 pt-4">
                {tier.features.map((feature, featureIndex) => (
                  <li 
                    key={featureIndex}
                    className="flex items-start gap-3 text-on-surface-variant text-sm"
                  >
                    <svg 
                      className="w-5 h-5 text-tertiary-fixed-dim flex-shrink-0 mt-0.5" 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M5 13l4 4L19 7" 
                      />
                    </svg>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
