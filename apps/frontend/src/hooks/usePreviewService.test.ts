import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { CustomizationConfig, PreviewData } from '@craft/types';
import { usePreviewService } from './usePreviewService';
import { previewService } from '@/services/preview.service';

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

const previewData: PreviewData = {
  html: '<html></html>',
  css: '',
  assets: [],
  branding: customization.branding,
  features: customization.features,
  mockData: { accountBalance: '0', recentTransactions: [], assetPrices: {} },
  viewport: { width: 1440, height: 900, class: 'desktop' },
};

describe('usePreviewService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('toggles isLoading and resolves with PreviewData on success', async () => {
    vi.spyOn(previewService, 'generatePreview').mockReturnValue(previewData);

    const { result } = renderHook(() => usePreviewService());

    expect(result.current.isLoading).toBe(false);

    let promise: Promise<PreviewData>;
    act(() => {
      promise = result.current.generatePreview(customization, 'desktop');
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await expect(promise).resolves.toEqual(previewData);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error to the thrown Error message and re-throws on failure', async () => {
    vi.spyOn(previewService, 'generatePreview').mockImplementation(() => {
      throw new Error('boom');
    });

    const { result } = renderHook(() => usePreviewService());

    await act(async () => {
      await expect(result.current.generatePreview(customization, 'desktop')).rejects.toThrow('boom');
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('boom');
  });

  it('falls back to a default message when a non-Error is thrown', async () => {
    vi.spyOn(previewService, 'generatePreview').mockImplementation(() => {
      throw 'not an error';
    });

    const { result } = renderHook(() => usePreviewService());

    await act(async () => {
      await expect(result.current.generatePreview(customization, 'desktop')).rejects.toThrow(
        'Failed to generate preview'
      );
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('Failed to generate preview');
  });

  it('refreshPreview delegates to generatePreview with the same arguments', async () => {
    const spy = vi.spyOn(previewService, 'generatePreview').mockReturnValue(previewData);

    const { result } = renderHook(() => usePreviewService());

    await act(async () => {
      await result.current.refreshPreview(customization, 'mobile');
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(customization, 'mobile');
  });
});
