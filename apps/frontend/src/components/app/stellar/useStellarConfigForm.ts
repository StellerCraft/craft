'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import type { StellarConfig, AssetPair, ValidationError } from '@craft/types';
import { HORIZON_URLS } from '@craft/stellar';
import { validateContractAddresses } from '@/lib/stellar/contract-validation';
import {
    checkHorizonEndpoint,
    checkSorobanRpcEndpoint,
    type ConnectivityCheckResult,
} from '@/lib/stellar/endpoint-connectivity';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectivityStatus = 'idle' | 'checking' | 'ok' | 'error';

export interface StellarConfigFormState {
    stellar: StellarConfig;
}

export interface StellarConfigFormReturn {
    state: StellarConfigFormState;
    errors: Map<string, string>;
    isDirty: boolean;
    connectivityStatus: ConnectivityStatus;
    connectivityResult: ConnectivityCheckResult | null;
    sorobanConnectivityStatus: ConnectivityStatus;
    sorobanConnectivityResult: ConnectivityCheckResult | null;
    setStellar: <K extends keyof StellarConfig>(key: K, value: StellarConfig[K]) => void;
    addAssetPair: (pair: AssetPair) => void;
    removeAssetPair: (index: number) => void;
    setContractAddress: (name: string, address: string) => void;
    removeContractAddress: (name: string) => void;
    validate: () => ValidationError[];
    checkConnectivity: () => Promise<void>;
    checkSorobanConnectivity: () => Promise<void>;
    reset: () => void;
}

// ── Validation ────────────────────────────────────────────────────────────────

const URL_PATTERN = /^https?:\/\/.+/;
const MAINNET_HORIZON = 'https://horizon.stellar.org';
const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';

function validateStellarFields(state: StellarConfigFormState): ValidationError[] {
    const errors: ValidationError[] = [];
    const { network, horizonUrl, sorobanRpcUrl, contractAddresses } = state.stellar;

    if (network !== 'mainnet' && network !== 'testnet') {
        errors.push({
            field: 'stellar.network',
            message: 'Network must be mainnet or testnet',
            code: 'UNSUPPORTED_NETWORK',
        });
    }

    if (!horizonUrl || !URL_PATTERN.test(horizonUrl)) {
        errors.push({
            field: 'stellar.horizonUrl',
            message: 'Horizon URL must be a valid http/https URL',
            code: 'INVALID_URL',
        });
    } else {
        if (network === 'mainnet' && horizonUrl === TESTNET_HORIZON) {
            errors.push({
                field: 'stellar.horizonUrl',
                message: 'Horizon URL points to testnet but network is mainnet',
                code: 'HORIZON_NETWORK_MISMATCH',
            });
        }
        if (network === 'testnet' && horizonUrl === MAINNET_HORIZON) {
            errors.push({
                field: 'stellar.horizonUrl',
                message: 'Horizon URL points to mainnet but network is testnet',
                code: 'HORIZON_NETWORK_MISMATCH',
            });
        }
    }

    if (sorobanRpcUrl && !URL_PATTERN.test(sorobanRpcUrl)) {
        errors.push({
            field: 'stellar.sorobanRpcUrl',
            message: 'Soroban RPC URL must be a valid http/https URL',
            code: 'INVALID_URL',
        });
    }

    const contractValidation = validateContractAddresses(contractAddresses);
    if (!contractValidation.valid) {
        errors.push({
            field: contractValidation.field,
            message: contractValidation.reason,
            code: contractValidation.code,
        });
    }

    return errors;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useStellarConfigForm(initial: StellarConfigFormState): StellarConfigFormReturn {
    const [state, setState] = useState<StellarConfigFormState>(initial);
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
    const [connectivityStatus, setConnectivityStatus] = useState<ConnectivityStatus>('idle');
    const [connectivityResult, setConnectivityResult] = useState<ConnectivityCheckResult | null>(null);
    const [sorobanConnectivityStatus, setSorobanConnectivityStatus] = useState<ConnectivityStatus>('idle');
    const [sorobanConnectivityResult, setSorobanConnectivityResult] = useState<ConnectivityCheckResult | null>(null);
    const initialRef = useRef(initial);

    const isDirty = useMemo(() => {
        const init = initialRef.current.stellar;
        const curr = state.stellar;
        return (
            curr.network !== init.network ||
            curr.horizonUrl !== init.horizonUrl ||
            curr.sorobanRpcUrl !== init.sorobanRpcUrl ||
            JSON.stringify(curr.assetPairs) !== JSON.stringify(init.assetPairs) ||
            JSON.stringify(curr.contractAddresses) !== JSON.stringify(init.contractAddresses)
        );
    }, [state]);

    const setStellar = useCallback(<K extends keyof StellarConfig>(key: K, value: StellarConfig[K]) => {
        setState((prev) => {
            const updated = { ...prev.stellar, [key]: value };
            // Auto-update horizonUrl when network changes (only if it matches the old default)
            if (key === 'network') {
                const net = value as 'mainnet' | 'testnet';
                const oldDefault = HORIZON_URLS[prev.stellar.network as 'mainnet' | 'testnet'];
                if (prev.stellar.horizonUrl === oldDefault) {
                    updated.horizonUrl = HORIZON_URLS[net];
                }
            }
            return { ...prev, stellar: updated };
        });
        setValidationErrors((prev) => prev.filter((e) => e.field !== `stellar.${key}`));
        // Reset connectivity when URL changes
        if (key === 'horizonUrl') {
            setConnectivityStatus('idle');
            setConnectivityResult(null);
        }
        if (key === 'sorobanRpcUrl') {
            setSorobanConnectivityStatus('idle');
            setSorobanConnectivityResult(null);
        }
    }, []);

    const addAssetPair = useCallback((pair: AssetPair) => {
        setState((prev) => ({
            ...prev,
            stellar: {
                ...prev.stellar,
                assetPairs: [...(prev.stellar.assetPairs ?? []), pair],
            },
        }));
    }, []);

    const removeAssetPair = useCallback((index: number) => {
        setState((prev) => ({
            ...prev,
            stellar: {
                ...prev.stellar,
                assetPairs: (prev.stellar.assetPairs ?? []).filter((_, i) => i !== index),
            },
        }));
    }, []);

    const setContractAddress = useCallback((name: string, address: string) => {
        setState((prev) => ({
            ...prev,
            stellar: {
                ...prev.stellar,
                contractAddresses: { ...(prev.stellar.contractAddresses ?? {}), [name]: address },
            },
        }));
        setValidationErrors((prev) =>
            prev.filter((e) => e.field !== `stellar.contractAddresses.${name}`)
        );
    }, []);

    const removeContractAddress = useCallback((name: string) => {
        setState((prev) => {
            const { [name]: _, ...rest } = prev.stellar.contractAddresses ?? {};
            return {
                ...prev,
                stellar: { ...prev.stellar, contractAddresses: rest },
            };
        });
    }, []);

    const validate = useCallback((): ValidationError[] => {
        const errors = validateStellarFields(state);
        setValidationErrors(errors);
        return errors;
    }, [state]);

    const checkConnectivity = useCallback(async () => {
        setConnectivityStatus('checking');
        setConnectivityResult(null);
        try {
            const result = await checkHorizonEndpoint(state.stellar.horizonUrl);
            setConnectivityResult(result);
            setConnectivityStatus(result.reachable ? 'ok' : 'error');
        } catch {
            setConnectivityStatus('error');
            setConnectivityResult({
                reachable: false,
                endpoint: state.stellar.horizonUrl,
                errorType: 'TRANSIENT',
                error: 'Unexpected error during connectivity check',
            });
        }
    }, [state.stellar.horizonUrl]);

    const checkSorobanConnectivity = useCallback(async () => {
        const url = state.stellar.sorobanRpcUrl;
        if (!url) return;
        setSorobanConnectivityStatus('checking');
        setSorobanConnectivityResult(null);
        try {
            const result = await checkSorobanRpcEndpoint(url);
            setSorobanConnectivityResult(result);
            setSorobanConnectivityStatus(result.reachable ? 'ok' : 'error');
        } catch {
            setSorobanConnectivityStatus('error');
            setSorobanConnectivityResult({
                reachable: false,
                endpoint: url,
                errorType: 'TRANSIENT',
                error: 'Unexpected error during connectivity check',
            });
        }
    }, [state.stellar.sorobanRpcUrl]);

    const reset = useCallback(() => {
        setState(initialRef.current);
        setValidationErrors([]);
        setConnectivityStatus('idle');
        setConnectivityResult(null);
        setSorobanConnectivityStatus('idle');
        setSorobanConnectivityResult(null);
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
        connectivityStatus,
        connectivityResult,
        sorobanConnectivityStatus,
        sorobanConnectivityResult,
        setStellar,
        addAssetPair,
        removeAssetPair,
        setContractAddress,
        removeContractAddress,
        validate,
        checkConnectivity,
        checkSorobanConnectivity,
        reset,
    };
}
