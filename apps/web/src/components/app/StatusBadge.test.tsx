import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders operational status', () => {
    render(<StatusBadge status="operational" />);
    expect(screen.getByText('ALL OPERATIONAL')).toBeDefined();
  });

  it('renders degraded status', () => {
    render(<StatusBadge status="degraded" />);
    expect(screen.getByText('DEGRADED PERFORMANCE')).toBeDefined();
  });

  it('renders outage status', () => {
    render(<StatusBadge status="outage" />);
    expect(screen.getByText('SERVICE OUTAGE')).toBeDefined();
  });

  it('renders maintenance status', () => {
    render(<StatusBadge status="maintenance" />);
    expect(screen.getByText('MAINTENANCE')).toBeDefined();
  });

  it('uses custom label when provided', () => {
    render(<StatusBadge status="operational" label="CUSTOM STATUS" />);
    expect(screen.getByText('CUSTOM STATUS')).toBeDefined();
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<StatusBadge status="operational" onClick={handleClick} />);
    
    fireEvent.click(screen.getByText('ALL OPERATIONAL'));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('renders as button when onClick provided', () => {
    const handleClick = vi.fn();
    render(<StatusBadge status="operational" onClick={handleClick} />);
    
    const element = screen.getByText('ALL OPERATIONAL').closest('button');
    expect(element).toBeDefined();
  });

  it('renders as div when no onClick', () => {
    render(<StatusBadge status="operational" />);
    
    const element = screen.getByText('ALL OPERATIONAL').closest('div');
    expect(element).toBeDefined();
  });

  it('applies correct color classes for operational', () => {
    const { container } = render(<StatusBadge status="operational" />);
    const element = container.firstChild as HTMLElement;
    expect(element?.className).toContain('bg-green');
  });

  it('applies correct color classes for degraded', () => {
    const { container } = render(<StatusBadge status="degraded" />);
    const element = container.firstChild as HTMLElement;
    expect(element?.className).toContain('bg-yellow');
  });

  it('applies correct color classes for outage', () => {
    const { container } = render(<StatusBadge status="outage" />);
    const element = container.firstChild as HTMLElement;
    expect(element?.className).toContain('bg-red');
  });
});
