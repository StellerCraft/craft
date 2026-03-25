import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavItem } from './NavItem';

describe('NavItem', () => {
  const mockIcon = <svg data-testid="test-icon" />;

  it('renders label and icon', () => {
    render(
      <NavItem
        label="Templates"
        icon={mockIcon}
        path="/app/templates"
      />
    );
    
    expect(screen.getByText('Templates')).toBeDefined();
    expect(screen.getByTestId('test-icon')).toBeDefined();
  });

  it('applies active state correctly', () => {
    render(
      <NavItem
        label="Templates"
        icon={mockIcon}
        path="/app/templates"
        active={true}
      />
    );
    
    const link = screen.getByRole('link');
    expect(link.className).toContain('bg-secondary-container');
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('shows badge when provided', () => {
    render(
      <NavItem
        label="Templates"
        icon={mockIcon}
        path="/app/templates"
        badge={5}
      />
    );
    
    expect(screen.getByText('5')).toBeDefined();
  });

  it('shows 99+ for badges over 99', () => {
    render(
      <NavItem
        label="Templates"
        icon={mockIcon}
        path="/app/templates"
        badge={150}
      />
    );
    
    expect(screen.getByText('99+')).toBeDefined();
  });

  it('disables interaction when disabled', () => {
    render(
      <NavItem
        label="Templates"
        icon={mockIcon}
        path="/app/templates"
        disabled={true}
      />
    );
    
    const element = screen.getByText('Templates').closest('div');
    expect(element?.className).toContain('opacity-40');
    expect(element?.className).toContain('cursor-not-allowed');
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(
      <NavItem
        label="Templates"
        icon={mockIcon}
        path="/app/templates"
        onClick={handleClick}
      />
    );
    
    fireEvent.click(screen.getByRole('link'));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('does not render as link when disabled', () => {
    render(
      <NavItem
        label="Templates"
        icon={mockIcon}
        path="/app/templates"
        disabled={true}
      />
    );
    
    expect(screen.queryByRole('link')).toBeNull();
  });
});
