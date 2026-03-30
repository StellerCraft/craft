import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateCard } from './TemplateCard';
import type { Template } from '@craft/types';

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
  customizationSchema: {} as any,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

describe('TemplateCard', () => {
  it('renders the template name and description', () => {
    render(<TemplateCard template={makeTemplate()} />);
    expect(screen.getByText('Stellar DEX')).toBeDefined();
    expect(screen.getByText('A decentralized exchange for trading Stellar assets.')).toBeDefined();
  });

  it('shows the category badge', () => {
    render(<TemplateCard template={makeTemplate({ category: 'payment' })} />);
    expect(screen.getByText('Payment')).toBeDefined();
  });

  it('shows the correct enabled feature count', () => {
    render(<TemplateCard template={makeTemplate()} />);
    expect(screen.getByText('1 feature enabled')).toBeDefined();
  });

  it('pluralises feature count correctly for multiple features', () => {
    const features = [
      { id: 'a', name: 'A', description: 'a', enabled: true, configurable: true },
      { id: 'b', name: 'B', description: 'b', enabled: true, configurable: true },
    ];
    render(<TemplateCard template={makeTemplate({ features })} />);
    expect(screen.getByText('2 features enabled')).toBeDefined();
  });

  it('renders "Use Template" button with accessible label', () => {
    render(<TemplateCard template={makeTemplate()} />);
    const btn = screen.getByRole('button', { name: 'Use Stellar DEX template' });
    expect(btn).toBeDefined();
  });

  it('calls onSelect when Use Template is clicked', async () => {
    const onSelect = vi.fn();
    const tpl = makeTemplate();
    render(<TemplateCard template={tpl} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use Stellar DEX template' }));
    expect(onSelect).toHaveBeenCalledWith(tpl);
  });

  it('renders category icon fallback when no preview image', () => {
    render(<TemplateCard template={makeTemplate({ previewImageUrl: '' })} />);
    expect(screen.getByText('📊')).toBeDefined();
  });

  it('renders preview image when URL is provided', () => {
    render(<TemplateCard template={makeTemplate({ previewImageUrl: '/thumb.png' })} />);
    const img = screen.getByAltText('Stellar DEX preview');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('/thumb.png');
  });

  it('maps all category labels correctly', () => {
    const categories = [
      { category: 'dex' as const, label: 'DEX' },
      { category: 'lending' as const, label: 'Lending' },
      { category: 'payment' as const, label: 'Payment' },
      { category: 'asset-issuance' as const, label: 'Asset Issuance' },
    ];

    categories.forEach(({ category, label }) => {
      const { unmount } = render(
        <TemplateCard template={makeTemplate({ category })} />,
      );
      expect(screen.getByText(label)).toBeDefined();
      unmount();
    });
  });
});
