import React from 'react';
import type { Template, TemplateCategory, TemplateMetadata } from '@craft/types';

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

export interface TemplateDetailViewProps {
  template: Template;
  metadata?: TemplateMetadata;
  onCustomize: (template: Template) => void;
}

/** Preview image with emoji fallback on missing URL or load error. */
function PreviewImage({ template }: { template: Template }) {
  const [failed, setFailed] = React.useState(false);
  const icon = CATEGORY_ICONS[template.category] ?? '📋';

  if (!template.previewImageUrl || failed) {
    return (
      <div
        className="w-full aspect-video bg-surface-container-high flex items-center justify-center rounded-xl"
        aria-label={`${template.name} preview placeholder`}
      >
        <span className="text-7xl" aria-hidden="true">{icon}</span>
      </div>
    );
  }

  return (
    <img
      src={template.previewImageUrl}
      alt={`${template.name} preview`}
      className="w-full aspect-video object-cover rounded-xl"
      onError={() => setFailed(true)}
    />
  );
}

/** Metadata sidebar panel: version, deployments, last updated. */
function MetadataSidebar({ metadata }: { metadata: TemplateMetadata }) {
  const lastUpdated =
    metadata.lastUpdated instanceof Date
      ? metadata.lastUpdated
      : new Date(metadata.lastUpdated);

  const items = [
    { label: 'Version', value: metadata.version },
    { label: 'Deployments', value: metadata.totalDeployments.toLocaleString() },
    {
      label: 'Last Updated',
      value: lastUpdated.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    },
  ];

  return (
    <aside aria-label="Template metadata" className="space-y-3">
      <h2 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">
        Template Info
      </h2>
      <dl className="space-y-2">
        {items.map(({ label, value }) => (
          <div
            key={label}
            className="flex justify-between items-center py-2 border-b border-outline-variant/10 last:border-0"
          >
            <dt className="text-sm text-on-surface-variant">{label}</dt>
            <dd className="text-sm font-semibold text-on-surface">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/** Feature list panel. */
function FeatureList({ features }: { features: Template['features'] }) {
  if (features.length === 0) return null;

  return (
    <section aria-labelledby="features-heading">
      <h2
        id="features-heading"
        className="text-lg font-bold font-headline text-on-surface mb-3"
      >
        Features
      </h2>
      <ul className="space-y-2" role="list">
        {features.map((f) => (
          <li
            key={f.id}
            className="flex items-start gap-3 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/10"
          >
            <span
              className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                f.enabled
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant'
              }`}
              aria-hidden="true"
            >
              {f.enabled ? '✓' : '○'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-on-surface">{f.name}</p>
              <p className="text-xs text-on-surface-variant mt-0.5">{f.description}</p>
            </div>
            {!f.enabled && (
              <span className="flex-shrink-0 text-xs text-on-surface-variant/60 italic">
                disabled
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Stellar configuration panel. */
function StellarPanel({ schema }: { schema: Template['customizationSchema'] }) {
  const stellar = schema?.stellar;
  if (!stellar) return null;

  const networks: string[] = stellar.network?.values ?? ['mainnet', 'testnet'];

  return (
    <section aria-labelledby="stellar-heading">
      <h2
        id="stellar-heading"
        className="text-lg font-bold font-headline text-on-surface mb-3"
      >
        Stellar Setup
      </h2>
      <dl className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/10">
          <dt className="text-sm font-semibold text-on-surface w-32 flex-shrink-0">Network</dt>
          <dd className="flex gap-2 flex-wrap">
            {networks.map((n) => (
              <span
                key={n}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary capitalize"
              >
                {n}
              </span>
            ))}
          </dd>
        </div>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/10">
          <dt className="text-sm font-semibold text-on-surface w-32 flex-shrink-0">Horizon URL</dt>
          <dd className="text-xs font-medium text-error">Required</dd>
        </div>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/10">
          <dt className="text-sm font-semibold text-on-surface w-32 flex-shrink-0">Soroban RPC</dt>
          <dd className="text-xs text-on-surface-variant/60">Optional</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * Full template detail view.
 *
 * Layout (lg+): two-column — main content left, metadata sidebar right.
 * Layout (mobile): single column, sidebar stacks below.
 */
export function TemplateDetailView({
  template,
  metadata,
  onCustomize,
}: TemplateDetailViewProps) {
  return (
    <article aria-label={`${template.name} template detail`}>
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md bg-primary text-on-primary">
            {CATEGORY_LABELS[template.category] ?? template.category}
          </span>
          <span className="text-xs text-on-surface-variant">Stellar</span>
        </div>
        <h1 className="text-3xl font-bold font-headline text-on-surface">
          {template.name}
        </h1>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-8">
          {/* Preview + description */}
          <section aria-labelledby="overview-heading">
            <PreviewImage template={template} />
            <div className="mt-4">
              <h2
                id="overview-heading"
                className="text-lg font-bold font-headline text-on-surface mb-2"
              >
                Overview
              </h2>
              <p className="text-on-surface-variant leading-relaxed">
                {template.description}
              </p>
            </div>
          </section>

          <FeatureList features={template.features} />
          <StellarPanel schema={template.customizationSchema} />
        </div>

        {/* Sidebar */}
        <div className="lg:w-64 flex-shrink-0 space-y-6">
          {/* CTA */}
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-5">
            <p className="text-sm font-semibold text-on-surface mb-1">Ready to deploy?</p>
            <p className="text-xs text-on-surface-variant mb-4">
              Customize branding, features, and Stellar settings before going live.
            </p>
            <button
              type="button"
              onClick={() => onCustomize(template)}
              className="w-full primary-gradient text-on-primary px-4 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all active:scale-95 text-sm"
              aria-label={`Customize and deploy ${template.name}`}
            >
              Customize &amp; Deploy
            </button>
          </div>

          {metadata && <MetadataSidebar metadata={metadata} />}
        </div>
      </div>
    </article>
  );
}
