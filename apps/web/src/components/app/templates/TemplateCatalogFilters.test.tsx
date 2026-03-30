import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateCatalogFilters } from './TemplateCatalogFilters';

describe('TemplateCatalogFilters', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders search input and all category buttons', () => {
    render(
      <TemplateCatalogFilters
        onCategoryChange={vi.fn()}
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('searchbox', { name: 'Search templates' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'All' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'DEX' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Lending' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Payment' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Asset Issuance' })).toBeDefined();
  });

  it('marks "All" as pressed when no category is selected', () => {
    render(
      <TemplateCatalogFilters
        onCategoryChange={vi.fn()}
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'DEX' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the selected category as pressed', () => {
    render(
      <TemplateCatalogFilters
        selectedCategory="dex"
        onCategoryChange={vi.fn()}
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'DEX' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onCategoryChange with the value when a category chip is clicked', async () => {
    const onCategoryChange = vi.fn();
    render(
      <TemplateCatalogFilters
        onCategoryChange={onCategoryChange}
        onSearchChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lending' }));
    expect(onCategoryChange).toHaveBeenCalledWith('lending');
  });

  it('calls onCategoryChange(undefined) when clicking an already-selected category', async () => {
    const onCategoryChange = vi.fn();
    render(
      <TemplateCatalogFilters
        selectedCategory="lending"
        onCategoryChange={onCategoryChange}
        onSearchChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lending' }));
    expect(onCategoryChange).toHaveBeenCalledWith(undefined);
  });

  it('calls onCategoryChange(undefined) when "All" is clicked', async () => {
    const onCategoryChange = vi.fn();
    render(
      <TemplateCatalogFilters
        selectedCategory="dex"
        onCategoryChange={onCategoryChange}
        onSearchChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onCategoryChange).toHaveBeenCalledWith(undefined);
  });

  it('debounces search input and calls onSearchChange', async () => {
    const onSearchChange = vi.fn();
    render(
      <TemplateCatalogFilters
        onCategoryChange={vi.fn()}
        onSearchChange={onSearchChange}
      />,
    );

    const input = screen.getByRole('searchbox');
    await userEvent.type(input, 'dex');

    expect(onSearchChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(onSearchChange).toHaveBeenCalledWith('dex');
  });

  it('populates the search input from searchQuery prop', () => {
    render(
      <TemplateCatalogFilters
        searchQuery="payment"
        onCategoryChange={vi.fn()}
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('searchbox')).toHaveValue('payment');
  });

  it('has a category filter group with accessible label', () => {
    render(
      <TemplateCatalogFilters
        onCategoryChange={vi.fn()}
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: 'Filter by category' })).toBeDefined();
  });
});
