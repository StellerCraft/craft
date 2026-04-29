import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeploymentProgressIndicator } from './DeploymentProgressIndicator';

describe('DeploymentProgressIndicator', () => {
  it('renders provided progress value in progressbar aria attributes', () => {
    render(
      <DeploymentProgressIndicator
        status="deploying"
        percentage={82}
        description="Deploying to edge regions"
      />,
    );

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('82');
  });

  it('falls back to default progress percentage when percentage is omitted', () => {
    render(<DeploymentProgressIndicator status="creating_repo" />);

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('40');
  });

  it('clamps out-of-range percentage values', () => {
    render(<DeploymentProgressIndicator status="pending" percentage={1000} />);

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('100');
  });
});
