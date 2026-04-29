import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeploymentDetailStatusBadge } from './DeploymentDetailStatusBadge';

describe('DeploymentDetailStatusBadge', () => {
  it('renders human-readable labels for backend deployment statuses', () => {
    render(<DeploymentDetailStatusBadge status="creating_repo" />);

    expect(screen.getByText('Creating Repository')).toBeDefined();
  });

  it('animates active statuses by default', () => {
    const { container } = render(<DeploymentDetailStatusBadge status="deploying" />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('does not animate terminal statuses', () => {
    const { container } = render(<DeploymentDetailStatusBadge status="completed" />);
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });
});
