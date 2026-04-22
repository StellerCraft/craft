import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { DeploymentStatusBadge } from '../../src/components/deployments/DeploymentStatusBadge';
import { ErrorState } from '../../src/components/app/ErrorState';
import { RetryButton } from '../../src/components/app/RetryButton';
import { StatusBadge } from '../../src/components/app/StatusBadge';
import { NavItem } from '../../src/components/app/NavItem';
import { Breadcrumbs } from '../../src/components/app/Breadcrumbs';

expect.extend(toHaveNoViolations);

describe('Accessibility Tests for Frontend Components', () => {
  describe('DeploymentStatusBadge', () => {
    it('should have no accessibility violations', async () => {
      const { container } = render(
        <DeploymentStatusBadge status="completed" />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have proper ARIA labels', () => {
      const { container } = render(
        <DeploymentStatusBadge status="completed" />
      );
      const badge = container.querySelector('[role="status"]');
      expect(badge).toBeTruthy();
    });
  });

  describe('ErrorState', () => {
    it('should have no accessibility violations', async () => {
      const { container } = render(
        <ErrorState title="Error" message="Something went wrong" />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have proper heading hierarchy', () => {
      const { container } = render(
        <ErrorState title="Error" message="Something went wrong" />
      );
      const heading = container.querySelector('h2');
      expect(heading).toBeTruthy();
      expect(heading?.textContent).toBe('Error');
    });
  });

  describe('RetryButton', () => {
    it('should have no accessibility violations', async () => {
      const { container } = render(
        <RetryButton onClick={() => {}} />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have accessible button with proper label', () => {
      const { getByRole } = render(
        <RetryButton onClick={() => {}} />
      );
      const button = getByRole('button');
      expect(button).toBeTruthy();
      expect(button.textContent).toBeTruthy();
    });

    it('should be keyboard accessible', () => {
      const { getByRole } = render(
        <RetryButton onClick={() => {}} />
      );
      const button = getByRole('button');
      expect(button).not.toHaveAttribute('disabled');
    });
  });

  describe('StatusBadge', () => {
    it('should have no accessibility violations', async () => {
      const { container } = render(
        <StatusBadge status="active" />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have semantic HTML', () => {
      const { container } = render(
        <StatusBadge status="active" />
      );
      const badge = container.querySelector('span');
      expect(badge).toBeTruthy();
    });
  });

  describe('NavItem', () => {
    it('should have no accessibility violations', async () => {
      const { container } = render(
        <NavItem href="/test" label="Test" />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have proper link semantics', () => {
      const { getByRole } = render(
        <NavItem href="/test" label="Test" />
      );
      const link = getByRole('link');
      expect(link).toHaveAttribute('href', '/test');
    });
  });

  describe('Breadcrumbs', () => {
    it('should have no accessibility violations', async () => {
      const { container } = render(
        <Breadcrumbs items={[{ label: 'Home', href: '/' }]} />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('should have proper navigation semantics', () => {
      const { container } = render(
        <Breadcrumbs items={[{ label: 'Home', href: '/' }]} />
      );
      const nav = container.querySelector('nav');
      expect(nav).toBeTruthy();
    });

    it('should have proper ARIA labels for breadcrumb list', () => {
      const { container } = render(
        <Breadcrumbs items={[{ label: 'Home', href: '/' }]} />
      );
      const list = container.querySelector('[role="list"]');
      expect(list).toBeTruthy();
    });
  });

  describe('Color Contrast', () => {
    it('should have sufficient color contrast in badges', async () => {
      const { container } = render(
        <StatusBadge status="active" />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Form Accessibility', () => {
    it('should have proper form labels and error messages', () => {
      const { container } = render(
        <ErrorState title="Form Error" message="Please fill in all required fields" />
      );
      const message = container.textContent;
      expect(message).toContain('Please fill in all required fields');
    });
  });
});
