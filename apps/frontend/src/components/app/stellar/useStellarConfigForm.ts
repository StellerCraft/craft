'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import type { StellarConfig, AssetPair, ValidationError } from '@craft/types';
import { validateStellarConfig, DEFAULT_STELLAR_CONFIG } from '@/lib/customization/validate-stellar';

export interface StellarConfigFormReturn {
    state: StellarConfig;
    errors: Map<string, string>;
    isDirty: boolean;
    setField: <K extends keyof StellarConfig>(key: K, value: StellarConfig[K]) => void;
    setAssetPairs: (pairs: AssetPair[]) => void;
    setContractAddress: (key: string, value: string) => void;
    removeContractAddress: (key: string) => void;
    validate: () => ValidationError[];
    reset: () => void;
}

export function useStellarConfigForm(
    initial: StellarConfig = DEFAULT_STELLAR_CONFIG
): StellarConfigFormReturn {
    const [state, setState] = useState<StellarConfig>(initial);
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
    const initialRef = useRef(initial);

    const isDirty = useMemo(() => {
        const init = initialRef.current;
        return (
            state.network !== init.network ||
            state.horizonUrl !== init.horizonUrl ||
            state.sorobanRpcUrl !== init.sorobanRpcUrl ||
            JSON.stringify(state.assetPairs) !== JSON.stringify(init.assetPairs) ||
            JSON.stringify(state.contractAddresses) !== JSON.stringify(init.contractAddresses)
        );
    }, [state]);

    const setField = useCallback(<K extends keyof StellarConfig>(key: K, value: StellarConfig[K]) => {
        setState((prev) => ({ ...prev, [key]: value }));
        setValidationErrors((prev) => prev.filter((e) => !e.field.startsWith(`stellar.${key}`) && e.field !== key));
    }, []);

    const setAssetPairs = useCallback((pairs: AssetPair[]) => {
        setState((prev) => ({ ...prev, assetPairs: pairs }));
        setValidationErrors((prev) => prev.filter((e) => !e.field.startsWith('assetPairs')));
    }, []);

    const setContractAddress = useCallback((key: string, value: string) => {
        setState((prev) => ({
            ...prev,
            contractAddresses: { ...prev.contractAddresses, [key]: value },
        }));
        setValidationErrors((prev) => prev.filter((e) => !e.field.startsWith(`contractAddresses.${key}`)));
    }, []);

    const removeContractAddress = useCallback((key: string) => {
        setState((prev) => {
            const next = { ...prev.contractAddresses };
            delete next[key];
            return { ...prev, contractAddresses: next };
        });
    }, []);

    const validate = useCallback((): ValidationError[] => {
        const result = validateStellarConfig(state);
        setValidationErrors(result.errors);
        return result.errors;
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

    return {
        state,
        errors,
        isDirty,
        setField,
        setAssetPairs,
        setContractAddress,
        removeContractAddress,
        validate,
        reset,
    };
}
