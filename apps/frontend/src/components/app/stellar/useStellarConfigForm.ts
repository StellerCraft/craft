'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import type { StellarConfig, AssetPair, ValidationError } from '@craft/types';
import { validateStellarConfig, DEFAULT_STELLAR_CONFIG } from '@/lib/customization/validate-stellar';
import {
    checkHorizonEndpoint,
    checkSorobanRpcEndpoint,
    type ConnectivityCheckResult,
} from '@/lib/stellar/endpoint-connectivity';

export type ConnectivityStatus = 'idle' | 'checking' | 'ok' | 'error';

export interface ConnectivityState {
    status: ConnectivityStatus;
    result: ConnectivityCheckResult | null;
}

export interface StellarConfigFormReturn {
    state: StellarConfig;
    errors: Map<string, string>;
    isDirty: boolean;
    connectivity: {
        horizon: ConnectivityState;
        sorobanRpc: ConnectivityState;
    };
    connectivityStatus: ConnectivityStatus;
    connectivityResult: ConnectivityCheckResult | null;
    sorobanConnectivityStatus: ConnectivityStatus;
    sorobanConnectivityResult: ConnectivityCheckResult | null;
    checkHorizonConnectivity: () => Promise<void>;
    checkSorobanConnectivity: () => Promise<void>;
    checkConnectivity: () => Promise<void>;
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
    const [connectivity, setConnectivity] = useState<{
        horizon: ConnectivityState;
        sorobanRpc: ConnectivityState;
    }>({
        horizon: { status: 'idle', result: null },
        sorobanRpc: { status: 'idle', result: null },
    });
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
        if (key === 'horizonUrl') {
            setConnectivity((prev) => ({
                ...prev,
                horizon: { status: 'idle', result: null },
            }));
        }
        if (key === 'sorobanRpcUrl') {
            setConnectivity((prev) => ({
                ...prev,
                sorobanRpc: { status: 'idle', result: null },
            }));
        }
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

    const checkHorizonConnectivity = useCallback(async () => {
        setConnectivity((prev) => ({
            ...prev,
            horizon: { status: 'checking', result: null },
        }));
        try {
            const result = await checkHorizonEndpoint(state.horizonUrl);
            setConnectivity((prev) => ({
                ...prev,
                horizon: {
                    status: result.reachable ? 'ok' : 'error',
                    result,
                },
            }));
        } catch {
            setConnectivity((prev) => ({
                ...prev,
                horizon: {
                    status: 'error',
                    result: {
                        reachable: false,
                        endpoint: state.horizonUrl,
                        errorType: 'TRANSIENT',
                        error: 'Unexpected error during connectivity check',
                    },
                },
            }));
        }
    }, [state.horizonUrl]);

    const checkSorobanConnectivity = useCallback(async () => {
        const url = state.sorobanRpcUrl;
        if (!url) return;
        setConnectivity((prev) => ({
            ...prev,
            sorobanRpc: { status: 'checking', result: null },
        }));
        try {
            const result = await checkSorobanRpcEndpoint(url);
            setConnectivity((prev) => ({
                ...prev,
                sorobanRpc: {
                    status: result.reachable ? 'ok' : 'error',
                    result,
                },
            }));
        } catch {
            setConnectivity((prev) => ({
                ...prev,
                sorobanRpc: {
                    status: 'error',
                    result: {
                        reachable: false,
                        endpoint: url,
                        errorType: 'TRANSIENT',
                        error: 'Unexpected error during connectivity check',
                    },
                },
            }));
        }
    }, [state.sorobanRpcUrl]);

    const reset = useCallback(() => {
        setState(initialRef.current);
        setValidationErrors([]);
        setConnectivity({
            horizon: { status: 'idle', result: null },
            sorobanRpc: { status: 'idle', result: null },
        });
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
        connectivity,
        connectivityStatus: connectivity.horizon.status,
        connectivityResult: connectivity.horizon.result,
        sorobanConnectivityStatus: connectivity.sorobanRpc.status,
        sorobanConnectivityResult: connectivity.sorobanRpc.result,
        checkHorizonConnectivity,
        checkSorobanConnectivity,
        checkConnectivity: checkHorizonConnectivity,
        setField,
        setAssetPairs,
        setContractAddress,
        removeContractAddress,
        validate,
        reset,
    };
}
