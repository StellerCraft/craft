import React from 'react';

interface Template {
  title: string;
  description: string;
  image?: React.ReactNode;
  tag?: string;
}

interface TemplateShowcaseProps {
  title: string;
  subtitle?: string;
  templates: Template[];
}

export function TemplateShowcase({ 
  title, 
  subtitle, 
  templates 
}: TemplateShowcaseProps) {
  return (
    <section className="bg-surface-container-low py-24 lg:py-32">
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
        
        <div className="grid md:grid-cols-3 gap-8">
          {templates.map((template, index) => (
            <div 
              key={index}
              className="bg-surface-container-lowest rounded-lg overflow-hidden ambient-shadow hover:scale-105 transition-transform duration-200"
            >
              {template.image && (
                <div className="aspect-video bg-surface-container">
                  {template.image}
                </div>
              )}
              <div className="p-6 space-y-3">
                {template.tag && (
                  <span className="inline-block px-3 py-1 text-xs font-medium bg-tertiary-container text-on-tertiary-container rounded-md">
                    {template.tag}
                  </span>
                )}
                <h3 className="text-xl font-display font-semibold text-on-surface">
                  {template.title}
                </h3>
                <p className="text-on-surface-variant text-sm">
                  {template.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
