'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import type { BrandingConfig, FeatureConfig, ValidationError } from '@craft/types';

export interface BrandingFormState {
    branding: BrandingConfig;
    features: FeatureConfig;
}

export interface BrandingFormReturn {
    state: BrandingFormState;
    errors: Map<string, string>;
    isDirty: boolean;
    setBranding: <K extends keyof BrandingConfig>(key: K, value: BrandingConfig[K]) => void;
    setFeatures: (features: FeatureConfig) => void;
    validate: () => ValidationError[];
    reset: () => void;
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function validateBrandingFields(state: BrandingFormState): ValidationError[] {
    const errors: ValidationError[] = [];
    const { branding } = state;

    if (!branding.appName.trim()) {
        errors.push({ field: 'branding.appName', message: 'App name is required', code: 'TOO_SMALL' });
    } else if (branding.appName.length > 60) {
        errors.push({ field: 'branding.appName', message: 'App name must be 60 characters or fewer', code: 'TOO_BIG' });
    }

    if (!HEX_COLOR.test(branding.primaryColor)) {
        errors.push({ field: 'branding.primaryColor', message: 'Primary color must be a valid hex color', code: 'INVALID_STRING' });
    }

    if (!HEX_COLOR.test(branding.secondaryColor)) {
        errors.push({ field: 'branding.secondaryColor', message: 'Secondary color must be a valid hex color', code: 'INVALID_STRING' });
    }

    if (
        HEX_COLOR.test(branding.primaryColor) &&
        HEX_COLOR.test(branding.secondaryColor) &&
        branding.primaryColor.toLowerCase() === branding.secondaryColor.toLowerCase()
    ) {
        errors.push({ field: 'branding.secondaryColor', message: 'Secondary color must differ from primary color', code: 'DUPLICATE_COLORS' });
    }

    if (!branding.fontFamily.trim()) {
        errors.push({ field: 'branding.fontFamily', message: 'Font family is required', code: 'TOO_SMALL' });
    }

    return errors;
}

export function useBrandingForm(initial: BrandingFormState): BrandingFormReturn {
    const [state, setState] = useState<BrandingFormState>(initial);
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
    const initialRef = useRef(initial);

    const isDirty = useMemo(() => {
        const init = initialRef.current;
        return (
            state.branding.appName !== init.branding.appName ||
            state.branding.primaryColor !== init.branding.primaryColor ||
            state.branding.secondaryColor !== init.branding.secondaryColor ||
            state.branding.fontFamily !== init.branding.fontFamily ||
            state.branding.logoUrl !== init.branding.logoUrl ||
            state.features.enableCharts !== init.features.enableCharts ||
            state.features.enableTransactionHistory !== init.features.enableTransactionHistory ||
            state.features.enableAnalytics !== init.features.enableAnalytics ||
            state.features.enableNotifications !== init.features.enableNotifications
        );
    }, [state]);

    const setBranding = useCallback(<K extends keyof BrandingConfig>(key: K, value: BrandingConfig[K]) => {
        setState((prev) => ({
            ...prev,
            branding: { ...prev.branding, [key]: value },
        }));
        // Clear field error on change
        setValidationErrors((prev) => prev.filter((e) => e.field !== `branding.${key}`));
    }, []);

    const setFeatures = useCallback((features: FeatureConfig) => {
        setState((prev) => ({ ...prev, features }));
    }, []);

    const validate = useCallback((): ValidationError[] => {
        const errors = validateBrandingFields(state);
        setValidationErrors(errors);
        return errors;
    }, [state]);

    const reset = useCallback(() => {
        setState(initialRef.current);
        setValidationErrors([]);
    }, []);

    const errors = useMemo(() => {
        const map = new Map<string, string>();
        for (const err of validationErrors) {
            map.set(err.field, err.message);
        }
        return map;
    }, [validationErrors]);

    return { state, errors, isDirty, setBranding, setFeatures, validate, reset };
}
