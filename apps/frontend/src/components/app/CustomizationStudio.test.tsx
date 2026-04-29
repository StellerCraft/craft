import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomizationStudio } from './CustomizationStudio';
import type { CustomizationConfig } from '@craft/types';

// ─── Fixture ──────────────────────────────────────────────────────────────────

const BASE_CONFIG: CustomizationConfig = {
  branding: {
    appName: 'My DEX',
    primaryColor: '#6366f1',
    secondaryColor: '#a5b4fc',
    fontFamily: 'Inter',
  },
  features: {
    enableCharts: true,
    enableTransactionHistory: true,
    enableAnalytics: false,
    enableNotifications: false,
  },
  stellar: {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
};

function renderStudio(overrides: Partial<Parameters<typeof CustomizationStudio>[0]> = {}) {
  const props = {
    config: BASE_CONFIG,
    isDirty: false,
    saveState: 'idle' as const,
    onChange: vi.fn(),
    onSave: vi.fn(),
    onDeploy: vi.fn(),
    ...overrides,
  };
  return { ...render(<CustomizationStudio {...props} />), props };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CustomizationStudio', () => {
  describe('tab navigation', () => {
    it('renders both tabs', () => {
      renderStudio();
      expect(screen.getByRole('tab', { name: /Branding/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /Stellar/i })).toBeDefined();
    });

    it('shows Branding panel by default', () => {
      renderStudio();
      const brandingPanel = screen.getByRole('tabpanel', { name: /Branding/i });
      expect(brandingPanel.getAttribute('hidden')).toBeNull();
    });

    it('switches to Stellar panel on tab click', async () => {
      renderStudio();
      await userEvent.click(screen.getByRole('tab', { name: /Stellar/i }));
      const stellarPanel = screen.getByRole('tabpanel', { name: /Stellar/i });
      expect(stellarPanel.getAttribute('hidden')).toBeNull();
    });
  });

  describe('save state bar', () => {
    it('shows "Saving…" when saveState is saving', () => {
      renderStudio({ saveState: 'saving' });
      expect(screen.getAllByText('Saving…').length).toBeGreaterThan(0);
    });

    it('shows "✓ Saved" when saveState is saved', () => {
      renderStudio({ saveState: 'saved' });
      expect(screen.getByText('✓ Saved')).toBeDefined();
    });

    it('shows "⚠ Save failed" when saveState is error', () => {
      renderStudio({ saveState: 'error' });
      expect(screen.getByText('⚠ Save failed')).toBeDefined();
    });

    it('shows "Unsaved changes" when isDirty', () => {
      renderStudio({ isDirty: true });
      expect(screen.getByText('Unsaved changes')).toBeDefined();
    });

    it('calls onSave when Save button is clicked', async () => {
      const onSave = vi.fn();
      renderStudio({ isDirty: true, onSave });
      await userEvent.click(screen.getByRole('button', { name: 'Save customization' }));
      expect(onSave).toHaveBeenCalled();
    });

    it('Save button is disabled when not dirty', () => {
      renderStudio({ isDirty: false });
      const btn = screen.getByRole('button', { name: 'Save customization' });
      expect(btn.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('mainnet warning', () => {
    it('shows mainnet warning when network is mainnet', () => {
      renderStudio({
        config: {
          ...BASE_CONFIG,
          stellar: { ...BASE_CONFIG.stellar, network: 'mainnet' },
        },
      });
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/Mainnet selected/i)).toBeDefined();
    });

    it('does not show mainnet warning on testnet', () => {
      renderStudio();
      expect(screen.queryByText(/Mainnet selected/i)).toBeNull();
    });
  });

  describe('progression cues', () => {
    it('shows all three progression steps', () => {
      renderStudio();
      expect(screen.getByText('App name set')).toBeDefined();
      expect(screen.getByText('Colors configured')).toBeDefined();
      expect(screen.getByText('Horizon URL set')).toBeDefined();
    });

    it('shows correct done count', () => {
      renderStudio();
      // appName "My DEX" ✓, colors valid ✓, horizonUrl set ✓ → 3/3
      expect(screen.getByText('Setup progress (3/3)')).toBeDefined();
    });

    it('shows 0/3 when config is empty', () => {
      renderStudio({
        config: {
          ...BASE_CONFIG,
          branding: { ...BASE_CONFIG.branding, appName: '', primaryColor: 'bad', secondaryColor: 'bad' },
          stellar: { ...BASE_CONFIG.stellar, horizonUrl: '' },
        },
      });
      expect(screen.getByText('Setup progress (0/3)')).toBeDefined();
    });
  });

  describe('deploy CTA', () => {
    it('Deploy button is enabled when required fields are complete', () => {
      renderStudio();
      const btns = screen.getAllByRole('button', { name: 'Deploy this customization' });
      // At least one should not be disabled
      expect(btns.some((b) => !b.hasAttribute('disabled'))).toBe(true);
    });

    it('Deploy button is disabled when appName is empty', () => {
      renderStudio({
        config: { ...BASE_CONFIG, branding: { ...BASE_CONFIG.branding, appName: '' } },
      });
      const btns = screen.getAllByRole('button', { name: 'Deploy this customization' });
      expect(btns.every((b) => b.hasAttribute('disabled'))).toBe(true);
    });

    it('calls onDeploy when Deploy is clicked', async () => {
      const onDeploy = vi.fn();
      renderStudio({ onDeploy });
      const btns = screen.getAllByRole('button', { name: 'Deploy this customization' });
      const enabled = btns.find((b) => !b.hasAttribute('disabled'))!;
      await userEvent.click(enabled);
      expect(onDeploy).toHaveBeenCalled();
    });
  });
});
