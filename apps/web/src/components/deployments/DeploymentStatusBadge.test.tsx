import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeploymentStatusBadge } from './DeploymentStatusBadge';

describe('DeploymentStatusBadge', () => {
  const cases: Array<[import('@/types/deployment').DeploymentStatus, string]> = [
    ['running', 'Running'],
    ['success', 'Success'],
    ['failed', 'Failed'],
    ['queued', 'Queued'],
    ['cancelled', 'Cancelled'],
    ['rolling-back', 'Rolling Back'],
  ];

  it.each(cases)('renders label for status "%s"', (status, label) => {
    render(<DeploymentStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it('applies animate-pulse class only to running status by default', () => {
    const { container } = render(<DeploymentStatusBadge status="running" animated />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).not.toBeNull();
  });

  it('does not animate when animated=false', () => {
    const { container } = render(<DeploymentStatusBadge status="running" animated={false} />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeNull();
  });

  it('does not animate the dot for success status', () => {
    const { container } = render(<DeploymentStatusBadge status="success" animated />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeNull();
  });

  it('renders small size correctly', () => {
    const { container } = render(<DeploymentStatusBadge status="success" size="sm" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-[10px]');
  });
});
