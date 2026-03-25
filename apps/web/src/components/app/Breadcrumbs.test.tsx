import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Breadcrumbs } from './Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders all items', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Home', path: '/app' },
          { label: 'Templates', path: '/app/templates' },
          { label: 'Current' },
        ]}
      />
    );
    
    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Templates')).toBeDefined();
    expect(screen.getByText('Current')).toBeDefined();
  });

  it('makes items clickable except last', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Home', path: '/app' },
          { label: 'Templates', path: '/app/templates' },
          { label: 'Current' },
        ]}
      />
    );
    
    const homeLink = screen.getByText('Home');
    expect(homeLink.tagName).toBe('A');
    
    const currentItem = screen.getByText('Current');
    expect(currentItem.tagName).toBe('SPAN');
  });

  it('renders separators between items', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Home', path: '/app' },
          { label: 'Templates' },
        ]}
      />
    );
    
    const separators = screen.getAllByText('/');
    expect(separators.length).toBe(1);
  });

  it('uses custom separator', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Home', path: '/app' },
          { label: 'Templates' },
        ]}
        separator=">"
      />
    );
    
    expect(screen.getByText('>')).toBeDefined();
  });

  it('returns null when no items', () => {
    const { container } = render(<Breadcrumbs items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('handles items without paths', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Home' },
          { label: 'Templates' },
        ]}
      />
    );
    
    const items = screen.getAllByText(/Home|Templates/);
    items.forEach(item => {
      expect(item.tagName).toBe('SPAN');
    });
  });
});
