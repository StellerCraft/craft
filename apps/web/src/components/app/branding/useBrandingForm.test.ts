import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBrandingForm, type BrandingFormState } from './useBrandingForm';

const INITIAL: BrandingFormState = {
    branding: {
        appName: 'My App',
        primaryColor: '#000519',
        secondaryColor: '#545f73',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: true,
        enableAnalytics: false,
        enableNotifications: false,
    },
};

describe('useBrandingForm', () => {
    it('initializes with the given state', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        expect(result.current.state).toEqual(INITIAL);
        expect(result.current.isDirty).toBe(false);
        expect(result.current.errors.size).toBe(0);
    });

    it('tracks dirty state when branding changes', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        act(() => result.current.setBranding('appName', 'New Name'));
        expect(result.current.isDirty).toBe(true);
        expect(result.current.state.branding.appName).toBe('New Name');
    });

    it('tracks dirty state when features change', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        act(() =>
            result.current.setFeatures({ ...INITIAL.features, enableAnalytics: true }),
        );
        expect(result.current.isDirty).toBe(true);
    });

    it('is not dirty after reset', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        act(() => result.current.setBranding('appName', 'Changed'));
        expect(result.current.isDirty).toBe(true);
        act(() => result.current.reset());
        expect(result.current.isDirty).toBe(false);
        expect(result.current.state).toEqual(INITIAL);
    });

    it('validates empty app name', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        act(() => result.current.setBranding('appName', ''));
        let errors: any[];
        act(() => { errors = result.current.validate(); });
        expect(errors!.some((e) => e.field === 'branding.appName')).toBe(true);
        expect(result.current.errors.get('branding.appName')).toBe('App name is required');
    });

    it('validates invalid hex color', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        act(() => result.current.setBranding('primaryColor', 'notahex'));
        let errors: any[];
        act(() => { errors = result.current.validate(); });
        expect(errors!.some((e) => e.field === 'branding.primaryColor')).toBe(true);
    });

    it('validates duplicate colors', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        act(() => {
            result.current.setBranding('primaryColor', '#aabbcc');
            result.current.setBranding('secondaryColor', '#aabbcc');
        });
        let errors: any[];
        act(() => { errors = result.current.validate(); });
        expect(errors!.some((e) => e.code === 'DUPLICATE_COLORS')).toBe(true);
    });

    it('validates empty font family', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        act(() => result.current.setBranding('fontFamily', ''));
        let errors: any[];
        act(() => { errors = result.current.validate(); });
        expect(errors!.some((e) => e.field === 'branding.fontFamily')).toBe(true);
    });

    it('returns no errors for valid state', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        let errors: any[];
        act(() => { errors = result.current.validate(); });
        expect(errors!).toEqual([]);
        expect(result.current.errors.size).toBe(0);
    });

    it('clears field error when that field changes', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        act(() => result.current.setBranding('appName', ''));
        act(() => { result.current.validate(); });
        expect(result.current.errors.has('branding.appName')).toBe(true);
        act(() => result.current.setBranding('appName', 'Fixed'));
        expect(result.current.errors.has('branding.appName')).toBe(false);
    });

    it('clears all errors on reset', () => {
        const { result } = renderHook(() => useBrandingForm(INITIAL));
        act(() => result.current.setBranding('appName', ''));
        act(() => { result.current.validate(); });
        expect(result.current.errors.size).toBeGreaterThan(0);
        act(() => result.current.reset());
        expect(result.current.errors.size).toBe(0);
    });
});
