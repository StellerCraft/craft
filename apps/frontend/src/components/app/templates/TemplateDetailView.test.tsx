import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateDetailView } from './TemplateDetailView';
import type { Template, TemplateMetadata } from '@craft/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeTemplate = (overrides: Partial<Template> = {}): Template => ({
  id: 'tpl-1',
  name: 'Stellar DEX',
  description: 'A decentralized exchange for trading Stellar assets.',
  category: 'dex',
  blockchainType: 'stellar',
  baseRepositoryUrl: 'https://github.com/org/stellar-dex',
  previewImageUrl: '',
  features: [
    {
      id: 'enableCharts',
      name: 'Charts',
      description: 'Enable charts',
      enabled: true,
      configurable: true,
    },
    {
      id: 'enableAnalytics',
      name: 'Analytics',
      description: 'Enable analytics',
      enabled: false,
      configurable: true,
    },
  ],
  customizationSchema: {
    branding: {
      appName: { type: 'string', required: true },
      primaryColor: { type: 'color', required: true },
      secondaryColor: { type: 'color', required: true },
      fontFamily: { type: 'string', required: true },
    },
    features: {
      enableCharts: { type: 'boolean', default: true },
      enableTransactionHistory: { type: 'boolean', default: true },
      enableAnalytics: { type: 'boolean', default: false },
      enableNotifications: { type: 'boolean', default: false },
    },
    stellar: {
      network: { type: 'enum', values: ['mainnet', 'testnet'], required: true },
      horizonUrl: { type: 'string', required: true },
      sorobanRpcUrl: { type: 'string', required: false },
      assetPairs: { type: 'array', required: false },
    },
  },
  isActive: true,
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

const makeMetadata = (overrides: Partial<TemplateMetadata> = {}): TemplateMetadata => ({
  id: 'tpl-1',
  name: 'Stellar DEX',
  version: '1.2.0',
  lastUpdated: new Date('2024-06-15'),
  totalDeployments: 42,
  ...overrides,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TemplateDetailView', () => {
  // Header
  describe('header', () => {
    it('renders the template name as h1', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getByRole('heading', { level: 1, name: 'Stellar DEX' })).toBeDefined();
    });

    it('shows the category badge', () => {
      render(<TemplateDetailView template={makeTemplate({ category: 'payment' })} onCustomize={vi.fn()} />);
      expect(screen.getByText('Payment')).toBeDefined();
    });

    it('shows "Stellar" blockchain label', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getByText('Stellar')).toBeDefined();
    });
  });

  // Overview
  describe('OverviewSection', () => {
    it('renders the description', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(
        screen.getByText('A decentralized exchange for trading Stellar assets.'),
      ).toBeDefined();
    });

    it('renders preview image when URL is provided', () => {
      render(
        <TemplateDetailView
          template={makeTemplate({ previewImageUrl: '/thumb.png' })}
          onCustomize={vi.fn()}
        />,
      );
      const img = screen.getByAltText('Stellar DEX preview');
      expect(img).toBeDefined();
      expect(img.getAttribute('src')).toBe('/thumb.png');
    });

    it('renders emoji fallback when previewImageUrl is empty', () => {
      render(
        <TemplateDetailView
          template={makeTemplate({ previewImageUrl: '' })}
          onCustomize={vi.fn()}
        />,
      );
      // The placeholder div should be present (no img element)
      expect(screen.queryByRole('img', { name: 'Stellar DEX preview' })).toBeNull();
      expect(screen.getByText('📊')).toBeDefined();
    });
  });

  // Features
  describe('FeatureListSection', () => {
    it('renders all feature names', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getByText('Charts')).toBeDefined();
      expect(screen.getByText('Analytics')).toBeDefined();
    });

    it('marks disabled features with "disabled" label', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getByText('disabled')).toBeDefined();
    });

    it('renders nothing when features array is empty', () => {
      render(
        <TemplateDetailView
          template={makeTemplate({ features: [] })}
          onCustomize={vi.fn()}
        />,
      );
      expect(screen.queryByRole('heading', { name: 'Features' })).toBeNull();
    });
  });

  // Stellar config
  describe('StellarConfigSection', () => {
    it('renders Mainnet and Testnet network badges', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getByText('Mainnet')).toBeDefined();
      expect(screen.getByText('Testnet')).toBeDefined();
    });

    it('shows Horizon URL as Required', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      // There may be multiple "Required" labels; at least one should exist
      const required = screen.getAllByText('Required');
      expect(required.length).toBeGreaterThan(0);
    });

    it('shows Soroban RPC as Optional', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      const optional = screen.getAllByText('Optional');
      expect(optional.length).toBeGreaterThan(0);
    });

    it('renders nothing when customizationSchema.stellar is absent', () => {
      const tpl = makeTemplate();
      (tpl.customizationSchema as any).stellar = undefined;
      render(<TemplateDetailView template={tpl} onCustomize={vi.fn()} />);
      expect(screen.queryByRole('heading', { name: 'Stellar Configuration' })).toBeNull();
    });
  });

  // Metadata
  describe('MetadataSection', () => {
    it('renders version, deployments, and last updated when metadata is provided', () => {
      render(
        <TemplateDetailView
          template={makeTemplate()}
          metadata={makeMetadata()}
          onCustomize={vi.fn()}
        />,
      );
      expect(screen.getByText('1.2.0')).toBeDefined();
      expect(screen.getByText('42')).toBeDefined();
    });

    it('does not render metadata section when metadata is absent', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.queryByRole('heading', { name: 'Template Info' })).toBeNull();
    });
  });

  // CTA
  describe('CTASection', () => {
    it('renders the Customize & Deploy button', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(
        screen.getByRole('button', { name: 'Customize and deploy Stellar DEX' }),
      ).toBeDefined();
    });

    it('calls onCustomize with the template when button is clicked', async () => {
      const onCustomize = vi.fn();
      const tpl = makeTemplate();
      render(<TemplateDetailView template={tpl} onCustomize={onCustomize} />);

      await userEvent.click(
        screen.getByRole('button', { name: 'Customize and deploy Stellar DEX' }),
      );
      expect(onCustomize).toHaveBeenCalledWith(tpl);
    });
  });
});
