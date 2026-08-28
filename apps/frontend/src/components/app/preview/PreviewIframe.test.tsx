import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CustomizationConfig } from '@craft/types';
import { PreviewIframe } from './PreviewIframe';

const customization: CustomizationConfig = {
  branding: {
    appName: 'Test App',
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
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

describe('PreviewIframe', () => {
  it('includes the serialized customization in the generated src URL', async () => {
    render(
      <PreviewIframe
        templateId="template-1"
        customization={customization}
        viewport="desktop"
      />
    );

    const iframe = await waitFor(() => screen.getByTitle('Preview for desktop viewport'));

    await waitFor(() => {
      expect(iframe.getAttribute('src')).toContain('customization=');
    });

    const src = iframe.getAttribute('src') || '';
    const params = new URLSearchParams(src.split('?')[1]);
    expect(params.get('customization')).toBe(JSON.stringify(customization));
  });
});
