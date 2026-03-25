import React from 'react';

interface Feature {
  icon?: React.ReactNode;
  title: string;
  description: string;
}

interface FeatureGridProps {
  title?: string;
  subtitle?: string;
  features: Feature[];
  columns?: 2 | 3 | 4;
}

export function FeatureGrid({ 
  title, 
  subtitle, 
  features, 
  columns = 3 
}: FeatureGridProps) {
  const gridCols = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <section className="bg-surface py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {(title || subtitle) && (
          <div className="text-center mb-16 space-y-4">
            {title && (
              <h2 className="text-4xl lg:text-5xl font-display font-bold text-on-surface">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-lg text-on-surface-variant max-w-3xl mx-auto">
                {subtitle}
              </p>
            )}
          </div>
        )}
        
        <div className={`grid ${gridCols[columns]} gap-12`}>
          {features.map((feature, index) => (
            <div 
              key={index}
              className="space-y-4"
            >
              {feature.icon && (
                <div className="text-tertiary-fixed-dim">
                  {feature.icon}
                </div>
              )}
              <h3 className="text-xl font-display font-semibold text-on-surface">
                {feature.title}
              </h3>
              <p className="text-on-surface-variant leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
