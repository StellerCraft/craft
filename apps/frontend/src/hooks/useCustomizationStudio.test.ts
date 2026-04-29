import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCustomizationStudio } from './useCustomizationStudio';
import type { CustomizationConfig } from '@craft/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEMPLATE_ID = 'tpl-abc';

const DRAFT_CONFIG: CustomizationConfig = {
  branding: {
    appName: 'My DEX',
    primaryColor: '#ff0000',
    secondaryColor: '#00ff00',
    fontFamily: 'Roboto',
  },
  features: {
    enableCharts: true,
    enableTransactionHistory: false,
    enableAnalytics: false,
    enableNotifications: false,
  },
  stellar: {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (url, init) => Promise.resolve(handler(String(url), init as RequestInit)),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useCustomizationStudio', () => {
  it('starts in loading state', () => {
    mockFetch(() => new Response(JSON.stringify({ customizationConfig: DRAFT_CONFIG }), { status: 200 }));
    const { result } = renderHook(() => useCustomizationStudio(TEMPLATE_ID));
    expect(result.current.loading).toBe(true);
  });

  it('loads draft config from API', async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ customizationConfig: DRAFT_CONFIG }), { status: 200 }),
    );
    const { result } = renderHook(() => useCustomizationStudio(TEMPLATE_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config.branding.appName).toBe('My DEX');
  });

  it('uses default config when draft returns 404', async () => {
    mockFetch(() => new Response(null, { status: 404 }));
    const { result } = renderHook(() => useCustomizationStudio(TEMPLATE_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config.stellar.network).toBe('testnet');
    expect(result.current.loadError).toBeNull();
  });

  it('sets loadError on fetch failure', async () => {
    mockFetch(() => new Response(null, { status: 500 }));
    const { result } = renderHook(() => useCustomizationStudio(TEMPLATE_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toMatch(/500/);
  });

  it('isDirty is false after load', async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ customizationConfig: DRAFT_CONFIG }), { status: 200 }),
    );
    const { result } = renderHook(() => useCustomizationStudio(TEMPLATE_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isDirty).toBe(false);
  });

  it('isDirty becomes true after setConfig', async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ customizationConfig: DRAFT_CONFIG }), { status: 200 }),
    );
    const { result } = renderHook(() => useCustomizationStudio(TEMPLATE_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setConfig({
        ...DRAFT_CONFIG,
        branding: { ...DRAFT_CONFIG.branding, appName: 'Changed' },
      });
    });

    expect(result.current.isDirty).toBe(true);
  });

  it('save() sets saveState to saved on success', async () => {
    const fetchSpy = mockFetch((url, init) => {
      if ((init as RequestInit)?.method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ customizationConfig: DRAFT_CONFIG }), { status: 200 });
    });

    const { result } = renderHook(() => useCustomizationStudio(TEMPLATE_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.saveState).toBe('saved');
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/drafts/${TEMPLATE_ID}`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('save() sets saveState to error on failure', async () => {
    mockFetch((url, init) => {
      if ((init as RequestInit)?.method === 'POST') {
        return new Response(null, { status: 500 });
      }
      return new Response(JSON.stringify({ customizationConfig: DRAFT_CONFIG }), { status: 200 });
    });

    const { result } = renderHook(() => useCustomizationStudio(TEMPLATE_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.saveState).toBe('error');
  });

  it('auto-saves after debounce delay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const postCalls: string[] = [];
    mockFetch((url, init) => {
      if ((init as RequestInit)?.method === 'POST') postCalls.push(url);
      return new Response(JSON.stringify({ customizationConfig: DRAFT_CONFIG }), { status: 200 });
    });

    const { result } = renderHook(() => useCustomizationStudio(TEMPLATE_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setConfig({
        ...DRAFT_CONFIG,
        branding: { ...DRAFT_CONFIG.branding, appName: 'Auto' },
      });
    });

    expect(postCalls).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(postCalls.length).toBeGreaterThan(0);

    vi.useRealTimers();
  });
});
