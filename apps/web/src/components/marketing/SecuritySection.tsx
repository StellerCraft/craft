import React from 'react';

interface SecurityFeature {
  title: string;
  description: string;
}

interface SecuritySectionProps {
  title: string;
  subtitle?: string;
  features: SecurityFeature[];
  image?: React.ReactNode;
}

export function SecuritySection({ 
  title, 
  subtitle, 
  features,
  image 
}: SecuritySectionProps) {
  return (
    <section className="bg-primary text-on-primary py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="space-y-12">
            <div className="space-y-4">
              <h2 className="text-4xl lg:text-5xl font-display font-bold">
                {title}
              </h2>
              {subtitle && (
                <p className="text-lg text-on-primary/80">
                  {subtitle}
                </p>
              )}
            </div>
            
            <div className="space-y-8">
              {features.map((feature, index) => (
                <div key={index} className="space-y-2">
                  <h3 className="text-xl font-display font-semibold">
                    {feature.title}
                  </h3>
                  <p className="text-on-primary/70 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
          
          {image && (
            <div className="relative">
              {image}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
