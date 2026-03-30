import React from 'react';
import type { Template, TemplateCategory } from '@craft/types';

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  dex: 'DEX',
  lending: 'Lending',
  payment: 'Payment',
  'asset-issuance': 'Asset Issuance',
};

const CATEGORY_ICONS: Record<TemplateCategory, string> = {
  dex: '📊',
  lending: '🏦',
  payment: '💳',
  'asset-issuance': '🪙',
};

interface TemplateCardProps {
  template: Template;
  onSelect?: (template: Template) => void;
}

export function TemplateCard({ template, onSelect }: TemplateCardProps) {
  const featureCount = template.features.filter((f) => f.enabled).length;

  return (
    <article
      className="group flex flex-col bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden hover:shadow-lg hover:border-outline-variant/25 transition-all duration-200"
    >
      <div className="aspect-video bg-surface-container-high relative flex items-center justify-center">
        {template.previewImageUrl ? (
          <img
            src={template.previewImageUrl}
            alt={`${template.name} preview`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-5xl" aria-hidden="true">
            {CATEGORY_ICONS[template.category]}
          </span>
        )}

        <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md bg-primary text-on-primary">
          {CATEGORY_LABELS[template.category]}
        </span>
      </div>

      <div className="flex flex-col flex-1 p-5 gap-3">
        <h3 className="text-lg font-bold font-headline text-on-surface group-hover:text-on-primary-container transition-colors">
          {template.name}
        </h3>

        <p className="text-sm text-on-surface-variant leading-relaxed line-clamp-2 flex-1">
          {template.description}
        </p>

        <div className="flex items-center justify-between pt-2 border-t border-outline-variant/10">
          <span className="text-xs text-on-surface-variant">
            {featureCount} feature{featureCount !== 1 ? 's' : ''} enabled
          </span>

          <button
            type="button"
            onClick={() => onSelect?.(template)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-on-primary-container transition-colors"
            aria-label={`Use ${template.name} template`}
          >
            Use Template
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
}
