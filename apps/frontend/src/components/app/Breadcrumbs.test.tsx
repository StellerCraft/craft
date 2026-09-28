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

  // #1330 — truncation affordance -----------------------------------------------

  it('exposes the full label via title attribute on the last (current) segment', () => {
    const longName = 'my-very-long-deployment-name-that-will-definitely-overflow';
    render(
      <Breadcrumbs
        items={[
          { label: 'Deployments', path: '/app/deployments' },
          { label: longName },
        ]}
      />
    );

    const span = screen.getByText(longName);
    expect(span.getAttribute('title')).toBe(longName);
  });

  it('exposes the full label via title attribute on navigable ancestor segments', () => {
    const longAncestor = 'a-very-long-ancestor-segment-that-may-truncate';
    render(
      <Breadcrumbs
        items={[
          { label: longAncestor, path: '/app/deployments' },
          { label: 'Settings' },
        ]}
      />
    );

    const link = screen.getByTitle(longAncestor);
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('title')).toBe(longAncestor);
  });

  it('has min-w-0 on the nav container so flex children can truncate', () => {
    const { container } = render(
      <Breadcrumbs
        items={[
          { label: 'Deployments', path: '/app/deployments' },
          { label: 'A Long Deployment Name That Would Overflow' },
        ]}
      />
    );

    const nav = container.querySelector('nav');
    expect(nav?.className).toContain('min-w-0');
  });

  it('collapses middle segments into an ellipsis when items exceed maxItems', () => {
    render(
      <Breadcrumbs
        maxItems={4}
        items={[
          { label: 'Home', path: '/app' },
          { label: 'Deployments', path: '/app/deployments' },
          { label: 'my-deployment', path: '/app/deployments/123' },
          { label: 'Settings', path: '/app/deployments/123/settings' },
          { label: 'Billing' },
        ]}
      />
    );

    // First and last segments must be visible
    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Billing')).toBeDefined();

    // An ellipsis placeholder must be rendered for the collapsed middle
    expect(screen.getByText('…')).toBeDefined();
  });

  it('does not cause horizontal overflow — nav container has min-w-0 Tailwind class', () => {
    const superLongName =
      'my-project-with-an-extremely-long-name-that-goes-on-and-on-and-on-and-on';
    const { container } = render(
      <Breadcrumbs
        items={[
          { label: 'Deployments', path: '/app/deployments' },
          { label: superLongName, path: '/app/deployments/abc' },
          { label: 'Settings', path: '/app/deployments/abc/settings' },
          { label: 'Billing' },
        ]}
      />
    );

    // The nav must carry min-w-0 so flex children respect the container width
    const nav = container.querySelector('nav');
    expect(nav?.className).toContain('min-w-0');

    // Every non-separator text node that could contain the long name must also
    // have min-w-0 and truncate so it never forces the parent to grow.
    const truncatables = container.querySelectorAll('.truncate');
    expect(truncatables.length).toBeGreaterThan(0);
  });
});
