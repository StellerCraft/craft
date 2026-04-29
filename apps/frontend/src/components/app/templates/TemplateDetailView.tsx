import React from 'react';
import type { Template, TemplateMetadata } from '@craft/types';

const CATEGORY_LABELS: Record<string, string> = {
  dex: 'DEX',
  lending: 'Lending',
  payment: 'Payment',
  'asset-issuance': 'Asset Issuance',
};

const CATEGORY_ICONS: Record<string, string> = {
  dex: '📊',
  lending: '🏦',
  payment: '💳',
  'asset-issuance': '🪙',
};

const NETWORK_LABELS: Record<string, string> = {
  mainnet: 'Mainnet',
  testnet: 'Testnet',
};

interface TemplateDetailViewProps {
  template: Template;
  metadata?: TemplateMetadata;
  onCustomize: (template: Template) => void;
}

/** Preview image with emoji fallback when URL is absent or fails to load. */
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

/** Overview section: preview image + description. */
function OverviewSection({ template }: { template: Template }) {
  return (
    <section aria-labelledby="overview-heading">
      <PreviewImage template={template} />
      <div className="mt-6">
        <h2
          id="overview-heading"
          className="text-xl font-bold font-headline text-on-surface mb-2"
        >
          Overview
        </h2>
        <p className="text-on-surface-variant leading-relaxed">{template.description}</p>
      </div>
    </section>
  );
}

/** Feature list section. */
function FeatureListSection({ template }: { template: Template }) {
  if (template.features.length === 0) return null;

  return (
    <section aria-labelledby="features-heading">
      <h2
        id="features-heading"
        className="text-xl font-bold font-headline text-on-surface mb-4"
      >
        Features
      </h2>
      <ul className="space-y-3" role="list">
        {template.features.map((feature) => (
          <li
            key={feature.id}
            className="flex items-start gap-3 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/10"
          >
            <span
              className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                feature.enabled
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant'
              }`}
              aria-hidden="true"
            >
              {feature.enabled ? '✓' : '○'}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">{feature.name}</p>
              <p className="text-xs text-on-surface-variant mt-0.5">{feature.description}</p>
            </div>
            {!feature.enabled && (
              <span className="ml-auto flex-shrink-0 text-xs text-on-surface-variant/60 italic">
                disabled
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Stellar configuration section. */
function StellarConfigSection({ template }: { template: Template }) {
  const stellar = template.customizationSchema?.stellar;
  if (!stellar) return null;

  const networkValues: string[] = stellar.network?.values ?? ['mainnet', 'testnet'];
  const horizonRequired = stellar.horizonUrl?.required ?? true;
  const sorobanOptional = !stellar.sorobanRpcUrl?.required;

  return (
    <section aria-labelledby="stellar-heading">
      <h2
        id="stellar-heading"
        className="text-xl font-bold font-headline text-on-surface mb-4"
      >
        Stellar Configuration
      </h2>
      <dl className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/10">
          <dt className="text-sm font-semibold text-on-surface w-40 flex-shrink-0">Network</dt>
          <dd className="flex gap-2 flex-wrap">
            {networkValues.map((n) => (
              <span
                key={n}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary"
              >
                {NETWORK_LABELS[n] ?? n}
              </span>
            ))}
          </dd>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/10">
          <dt className="text-sm font-semibold text-on-surface w-40 flex-shrink-0">Horizon URL</dt>
          <dd className="text-sm text-on-surface-variant">
            {horizonRequired ? (
              <span className="text-xs font-medium text-error">Required</span>
            ) : (
              <span className="text-xs text-on-surface-variant/60">Optional</span>
            )}
          </dd>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/10">
          <dt className="text-sm font-semibold text-on-surface w-40 flex-shrink-0">Soroban RPC</dt>
          <dd className="text-sm text-on-surface-variant">
            {sorobanOptional ? (
              <span className="text-xs text-on-surface-variant/60">Optional</span>
            ) : (
              <span className="text-xs font-medium text-error">Required</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** Metadata section: version, deployments, last updated. */
function MetadataSection({ metadata }: { metadata: TemplateMetadata }) {
  const lastUpdated = metadata.lastUpdated instanceof Date
    ? metadata.lastUpdated
    : new Date(metadata.lastUpdated);

  return (
    <section aria-labelledby="metadata-heading">
      <h2
        id="metadata-heading"
        className="text-xl font-bold font-headline text-on-surface mb-4"
      >
        Template Info
      </h2>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: 'Version', value: metadata.version },
          {
            label: 'Deployments',
            value: metadata.totalDeployments.toLocaleString(),
          },
          {
            label: 'Last Updated',
            value: lastUpdated.toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            }),
          },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="p-3 rounded-lg bg-surface-container-lowest border border-outline-variant/10"
          >
            <dt className="text-xs text-on-surface-variant mb-1">{label}</dt>
            <dd className="text-sm font-semibold text-on-surface">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** CTA section. */
function CTASection({
  template,
  onCustomize,
}: {
  template: Template;
  onCustomize: (template: Template) => void;
}) {
  return (
    <section
      aria-labelledby="cta-heading"
      className="rounded-xl bg-primary/5 border border-primary/20 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
    >
      <div>
        <h2
          id="cta-heading"
          className="text-lg font-bold font-headline text-on-surface mb-1"
        >
          Ready to deploy?
        </h2>
        <p className="text-sm text-on-surface-variant">
          Customize branding, features, and Stellar settings before going live.
        </p>
      </div>
      <button
        type="button"
        onClick={() => onCustomize(template)}
        className="primary-gradient text-on-primary px-6 py-3 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all active:scale-95 whitespace-nowrap"
        aria-label={`Customize and deploy ${template.name}`}
      >
        Customize &amp; Deploy
      </button>
    </section>
  );
}

/**
 * Full template detail view composed of:
 * - Overview (preview image + description)
 * - Feature list
 * - Stellar configuration
 * - Metadata (version, deployments, last updated)
 * - CTA (customize & deploy)
 */
export function TemplateDetailView({
  template,
  metadata,
  onCustomize,
}: TemplateDetailViewProps) {
  return (
    <article aria-label={`${template.name} template detail`}>
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-md bg-primary text-on-primary">
            {CATEGORY_LABELS[template.category] ?? template.category}
          </span>
          <span className="text-xs text-on-surface-variant">Stellar</span>
        </div>
        <h1 className="text-3xl font-bold font-headline text-on-surface">{template.name}</h1>
      </header>

      <div className="space-y-10">
        <OverviewSection template={template} />
        <FeatureListSection template={template} />
        <StellarConfigSection template={template} />
        {metadata && <MetadataSection metadata={metadata} />}
        <CTASection template={template} onCustomize={onCustomize} />
      </div>
    </article>
  );
}
