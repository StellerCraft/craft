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
    { id: 'enableCharts', name: 'Charts', description: 'Enable charts', enabled: true, configurable: true },
    { id: 'enableAnalytics', name: 'Analytics', description: 'Enable analytics', enabled: false, configurable: true },
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

  describe('overview', () => {
    it('renders the description', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getByText('A decentralized exchange for trading Stellar assets.')).toBeDefined();
    });

    it('renders preview image when URL is provided', () => {
      render(
        <TemplateDetailView
          template={makeTemplate({ previewImageUrl: '/thumb.png' })}
          onCustomize={vi.fn()}
        />,
      );
      const img = screen.getByAltText('Stellar DEX preview');
      expect(img.getAttribute('src')).toBe('/thumb.png');
    });

    it('renders emoji fallback when previewImageUrl is empty', () => {
      render(<TemplateDetailView template={makeTemplate({ previewImageUrl: '' })} onCustomize={vi.fn()} />);
      expect(screen.queryByRole('img', { name: /preview/i })).toBeNull();
      expect(screen.getByText('📊')).toBeDefined();
    });
  });

  describe('feature list', () => {
    it('renders all feature names', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getByText('Charts')).toBeDefined();
      expect(screen.getByText('Analytics')).toBeDefined();
    });

    it('marks disabled features', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getByText('disabled')).toBeDefined();
    });

    it('renders nothing when features array is empty', () => {
      render(<TemplateDetailView template={makeTemplate({ features: [] })} onCustomize={vi.fn()} />);
      expect(screen.queryByRole('heading', { name: 'Features' })).toBeNull();
    });
  });

  describe('Stellar setup panel', () => {
    it('renders network options', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getByText('mainnet')).toBeDefined();
      expect(screen.getByText('testnet')).toBeDefined();
    });

    it('shows Horizon URL as Required', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getAllByText('Required').length).toBeGreaterThan(0);
    });

    it('shows Soroban RPC as Optional', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.getAllByText('Optional').length).toBeGreaterThan(0);
    });

    it('omits panel when stellar schema is absent', () => {
      const tpl = makeTemplate();
      (tpl.customizationSchema as any).stellar = undefined;
      render(<TemplateDetailView template={tpl} onCustomize={vi.fn()} />);
      expect(screen.queryByRole('heading', { name: 'Stellar Setup' })).toBeNull();
    });
  });

  describe('metadata sidebar', () => {
    it('renders version and deployment count when metadata provided', () => {
      render(
        <TemplateDetailView template={makeTemplate()} metadata={makeMetadata()} onCustomize={vi.fn()} />,
      );
      expect(screen.getByText('1.2.0')).toBeDefined();
      expect(screen.getByText('42')).toBeDefined();
    });

    it('omits sidebar when metadata is absent', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(screen.queryByText('Template Info')).toBeNull();
    });
  });

  describe('CTA', () => {
    it('renders the Customize & Deploy button', () => {
      render(<TemplateDetailView template={makeTemplate()} onCustomize={vi.fn()} />);
      expect(
        screen.getByRole('button', { name: 'Customize and deploy Stellar DEX' }),
      ).toBeDefined();
    });

    it('calls onCustomize with the template on click', async () => {
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
