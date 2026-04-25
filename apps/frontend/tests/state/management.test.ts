/**
 * Frontend State Management Tests
 *
 * Tests the React hook-based state stores used across the CRAFT frontend:
 *
 *   useBrandingForm  — branding + feature config form state
 *   useTemplates     — template list with filter state
 *   filtersToQueryString / filtersFromSearchParams — URL-serialised filter state
 *
 * State management architecture:
 *   - All state is local React useState; no external store library is used.
 *   - Form state is managed by useBrandingForm (initialisation, updates,
 *     validation, dirty tracking, reset).
 *   - Async list state is managed by useTemplates (loading, error, filters).
 *   - Filter state is persisted to / restored from URL search params so that
 *     filters survive page reloads and are shareable via link.
 *   - State updates are immutable: each setter returns a new object rather
 *     than mutating the previous value.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import {
  useBrandingForm,
  type BrandingFormState,
} from '../../src/components/app/branding/useBrandingForm';
import {
  filtersToQueryString,
  filtersFromSearchParams,
} from '../../src/components/app/templates/useTemplates';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeInitial(overrides: Partial<BrandingFormState> = {}): BrandingFormState {
  return {
    branding: {
      appName: 'My App',
      primaryColor: '#1a1a2e',
      secondaryColor: '#16213e',
      fontFamily: 'Inter',
      logoUrl: '',
      ...overrides.branding,
    },
    features: {
      enableCharts: true,
      enableTransactionHistory: false,
      enableAnalytics: false,
      enableNotifications: false,
      ...overrides.features,
    },
  };
}

// ── useBrandingForm — initialisation ─────────────────────────────────────────

describe('useBrandingForm — state initialisation', () => {
  it('initialises state from the provided initial value', () => {
    const initial = makeInitial();
    const { result } = renderHook(() => useBrandingForm(initial));

    expect(result.current.state.branding.appName).toBe('My App');
    expect(result.current.state.branding.primaryColor).toBe('#1a1a2e');
    expect(result.current.state.features.enableCharts).toBe(true);
  });

  it('starts with isDirty = false', () => {
    const { result } = renderHook(() => useBrandingForm(makeInitial()));
    expect(result.current.isDirty).toBe(false);
  });

  it('starts with no validation errors', () => {
    const { result } = renderHook(() => useBrandingForm(makeInitial()));
    expect(result.current.errors.size).toBe(0);
  });
});

// ── useBrandingForm — state updates ──────────────────────────────────────────

describe('useBrandingForm — state updates', () => {
  it('updates a branding field and marks state as dirty', () => {
    const { result } = renderHook(() => useBrandingForm(makeInitial()));

    act(() => result.current.setBranding('appName', 'New Name'));

    expect(result.current.state.branding.appName).toBe('New Name');
    expect(result.current.isDirty).toBe(true);
  });

  it('updates features and marks state as dirty', () => {
    const initial = makeInitial();
    const { result } = renderHook(() => useBrandingForm(initial));

    act(() =>
      result.current.setFeatures({ ...initial.features, enableAnalytics: true }),
    );

    expect(result.current.state.features.enableAnalytics).toBe(true);
    expect(result.current.isDirty).toBe(true);
  });

  it('does not mutate the initial state object', () => {
    const initial = makeInitial();
    const originalName = initial.branding.appName;
    const { result } = renderHook(() => useBrandingForm(initial));

    act(() => result.current.setBranding('appName', 'Changed'));

    expect(initial.branding.appName).toBe(originalName); // immutability
  });

  it('clears the field error when the field is updated', () => {
    const { result } = renderHook(() => useBrandingForm(makeInitial()));

    // Trigger a validation error first
    act(() => result.current.setBranding('appName', ''));
    act(() => result.current.validate());
    expect(result.current.errors.has('branding.appName')).toBe(true);

    // Fix the field — error should clear
    act(() => result.current.setBranding('appName', 'Fixed'));
    expect(result.current.errors.has('branding.appName')).toBe(false);
  });
});

// ── useBrandingForm — validation ─────────────────────────────────────────────

describe('useBrandingForm — validation', () => {
  it('returns no errors for valid state', () => {
    const { result } = renderHook(() => useBrandingForm(makeInitial()));
    let errors: ReturnType<typeof result.current.validate>;
    act(() => { errors = result.current.validate(); });
    expect(errors!).toHaveLength(0);
    expect(result.current.errors.size).toBe(0);
  });

  it('reports error when appName is empty', () => {
    const { result } = renderHook(() =>
      useBrandingForm(makeInitial({ branding: { appName: '' } as any })),
    );
    act(() => result.current.validate());
    expect(result.current.errors.get('branding.appName')).toBeTruthy();
  });

  it('reports error when appName exceeds 60 characters', () => {
    const { result } = renderHook(() =>
      useBrandingForm(makeInitial({ branding: { appName: 'a'.repeat(61) } as any })),
    );
    act(() => result.current.validate());
    expect(result.current.errors.get('branding.appName')).toBeTruthy();
  });

  it('reports error for invalid hex primary color', () => {
    const { result } = renderHook(() =>
      useBrandingForm(makeInitial({ branding: { primaryColor: 'not-a-color' } as any })),
    );
    act(() => result.current.validate());
    expect(result.current.errors.get('branding.primaryColor')).toBeTruthy();
  });

  it('reports error when primary and secondary colors are identical', () => {
    const { result } = renderHook(() =>
      useBrandingForm(
        makeInitial({ branding: { primaryColor: '#aabbcc', secondaryColor: '#aabbcc' } as any }),
      ),
    );
    act(() => result.current.validate());
    expect(result.current.errors.get('branding.secondaryColor')).toBeTruthy();
  });

  it('reports error when fontFamily is empty', () => {
    const { result } = renderHook(() =>
      useBrandingForm(makeInitial({ branding: { fontFamily: '' } as any })),
    );
    act(() => result.current.validate());
    expect(result.current.errors.get('branding.fontFamily')).toBeTruthy();
  });
});

// ── useBrandingForm — reset ───────────────────────────────────────────────────

describe('useBrandingForm — state reset', () => {
  it('restores state to initial values after reset', () => {
    const initial = makeInitial();
    const { result } = renderHook(() => useBrandingForm(initial));

    act(() => result.current.setBranding('appName', 'Changed'));
    act(() => result.current.reset());

    expect(result.current.state.branding.appName).toBe('My App');
  });

  it('clears isDirty after reset', () => {
    const { result } = renderHook(() => useBrandingForm(makeInitial()));

    act(() => result.current.setBranding('appName', 'Changed'));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.reset());
    expect(result.current.isDirty).toBe(false);
  });

  it('clears validation errors after reset', () => {
    const { result } = renderHook(() =>
      useBrandingForm(makeInitial({ branding: { appName: '' } as any })),
    );
    act(() => result.current.validate());
    expect(result.current.errors.size).toBeGreaterThan(0);

    act(() => result.current.reset());
    expect(result.current.errors.size).toBe(0);
  });
});

// ── Filter state — URL persistence ───────────────────────────────────────────

describe('Filter state — URL serialisation (persistence)', () => {
  it('serialises category filter to query string', () => {
    const qs = filtersToQueryString({ category: 'dex' });
    expect(qs).toContain('category=dex');
  });

  it('serialises search filter to query string', () => {
    const qs = filtersToQueryString({ search: 'stellar' });
    expect(qs).toContain('search=stellar');
  });

  it('omits undefined filters from query string', () => {
    const qs = filtersToQueryString({});
    expect(qs).toBe('');
  });

  it('round-trips filters through URL search params', () => {
    const original = { category: 'defi' as const, search: 'swap' };
    const qs = filtersToQueryString(original);
    const restored = filtersFromSearchParams(new URLSearchParams(qs));

    expect(restored.category).toBe(original.category);
    expect(restored.search).toBe(original.search);
  });

  it('restores empty filters from empty search params', () => {
    const restored = filtersFromSearchParams(new URLSearchParams(''));
    expect(restored.category).toBeUndefined();
    expect(restored.search).toBeUndefined();
  });

  it('ignores unknown params when restoring filters', () => {
    const restored = filtersFromSearchParams(new URLSearchParams('foo=bar'));
    expect(restored.category).toBeUndefined();
    expect(restored.search).toBeUndefined();
  });
});

// ── State synchronisation — multiple field updates ────────────────────────────

describe('useBrandingForm — state synchronisation', () => {
  it('applies multiple sequential updates correctly', () => {
    const { result } = renderHook(() => useBrandingForm(makeInitial()));

    act(() => {
      result.current.setBranding('appName', 'Alpha');
      result.current.setBranding('primaryColor', '#ffffff');
      result.current.setBranding('fontFamily', 'Roboto');
    });

    expect(result.current.state.branding.appName).toBe('Alpha');
    expect(result.current.state.branding.primaryColor).toBe('#ffffff');
    expect(result.current.state.branding.fontFamily).toBe('Roboto');
    // Other fields unchanged
    expect(result.current.state.branding.secondaryColor).toBe('#16213e');
  });

  it('feature update does not affect branding state', () => {
    const initial = makeInitial();
    const { result } = renderHook(() => useBrandingForm(initial));

    act(() =>
      result.current.setFeatures({ ...initial.features, enableCharts: false }),
    );

    expect(result.current.state.branding).toEqual(initial.branding);
  });

  it('branding update does not affect feature state', () => {
    const initial = makeInitial();
    const { result } = renderHook(() => useBrandingForm(initial));

    act(() => result.current.setBranding('appName', 'Changed'));

    expect(result.current.state.features).toEqual(initial.features);
  });
});
