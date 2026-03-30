import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TemplateGrid } from './TemplateGrid';
import type { Template } from '@craft/types';

vi.mock('@/lib/api/retryable-error', () => ({
  isRetryableError: () => true,
  getRetryHint: () => undefined,
}));

const makeTemplate = (id: string, name: string): Template => ({
  id,
  name,
  description: `${name} description`,
  category: 'dex',
  blockchainType: 'stellar',
  baseRepositoryUrl: 'https://example.com',
  previewImageUrl: '',
  features: [],
  customizationSchema: {} as any,
  isActive: true,
  createdAt: new Date(),
});

describe('TemplateGrid', () => {
  const defaultProps = {
    templates: [] as Template[],
    loading: false,
    error: null,
    hasFilters: false,
    onRetry: vi.fn(),
  };

  it('shows loading skeleton when loading', () => {
    render(<TemplateGrid {...defaultProps} loading={true} />);
    expect(screen.getByRole('status', { name: 'Loading templates' })).toBeDefined();
    expect(screen.getByText('Loading templates…')).toBeDefined();
  });

  it('shows error state with retry when error occurs', () => {
    render(
      <TemplateGrid
        {...defaultProps}
        error="Network error"
      />,
    );
    expect(screen.getByText('Failed to load templates')).toBeDefined();
    expect(screen.getByText('Network error')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined();
  });

  it('shows filtered empty state when no results and filters are active', () => {
    const onClearFilters = vi.fn();
    render(
      <TemplateGrid
        {...defaultProps}
        hasFilters={true}
        onClearFilters={onClearFilters}
      />,
    );
    expect(screen.getByText('No templates found')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Clear Filters' })).toBeDefined();
  });

  it('shows generic empty state when no results and no filters', () => {
    render(<TemplateGrid {...defaultProps} />);
    expect(screen.getByText('No templates available')).toBeDefined();
  });

  it('renders template cards in a list', () => {
    const templates = [
      makeTemplate('1', 'DEX Template'),
      makeTemplate('2', 'Lending Template'),
    ];
    render(
      <TemplateGrid
        {...defaultProps}
        templates={templates}
      />,
    );
    expect(screen.getByRole('list', { name: 'Template catalog' })).toBeDefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('DEX Template')).toBeDefined();
    expect(screen.getByText('Lending Template')).toBeDefined();
  });

  it('passes onSelect to template cards', () => {
    const onSelect = vi.fn();
    const templates = [makeTemplate('1', 'My Template')];
    render(
      <TemplateGrid
        {...defaultProps}
        templates={templates}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('button', { name: 'Use My Template template' })).toBeDefined();
  });

  it('does not show loading skeleton or error when templates are present', () => {
    const templates = [makeTemplate('1', 'Test')];
    render(
      <TemplateGrid {...defaultProps} templates={templates} />,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });
});
