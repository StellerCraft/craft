'use client';

import React from 'react';
import { NetworkSelector } from './NetworkSelector';
import { HorizonUrlInput } from './HorizonUrlInput';
import { SorobanRpcInput } from './SorobanRpcInput';
import { AssetPairEditor } from './AssetPairEditor';
import { ContractAddressInputs } from './ContractAddressInputs';
import type { StellarConfigFormReturn } from './useStellarConfigForm';

interface StellarConfigPanelProps {
    form: StellarConfigFormReturn;
    onSubmit: () => void;
    submitLabel?: string;
    isSubmitting?: boolean;
}

export function StellarConfigPanel({
    form,
    onSubmit,
    submitLabel = 'Save changes',
    isSubmitting = false,
}: StellarConfigPanelProps) {
    const {
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
    } = form;

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const validationErrors = validate();
        if (validationErrors.length === 0) {
            onSubmit();
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-8" noValidate>
            <ConfigSection title="Network">
                <NetworkSelector
                    value={state.stellar.network}
                    onChange={(v) => setStellar('network', v)}
                    error={errors.get('stellar.network')}
                />
            </ConfigSection>

            <ConfigSection title="Endpoints">
                <HorizonUrlInput
                    value={state.stellar.horizonUrl}
                    onChange={(v) => setStellar('horizonUrl', v)}
                    onCheckConnectivity={checkConnectivity}
                    connectivityStatus={connectivityStatus}
                    connectivityResult={connectivityResult}
                    error={errors.get('stellar.horizonUrl')}
                />
                <SorobanRpcInput
                    value={state.stellar.sorobanRpcUrl ?? ''}
                    onChange={(v) => setStellar('sorobanRpcUrl', v || undefined)}
                    onCheckConnectivity={checkSorobanConnectivity}
                    connectivityStatus={sorobanConnectivityStatus}
                    connectivityResult={sorobanConnectivityResult}
                    error={errors.get('stellar.sorobanRpcUrl')}
                />
            </ConfigSection>

            <ConfigSection title="Asset Pairs">
                <AssetPairEditor
                    pairs={state.stellar.assetPairs ?? []}
                    onAdd={addAssetPair}
                    onRemove={removeAssetPair}
                />
            </ConfigSection>

            <ConfigSection title="Smart Contracts">
                <ContractAddressInputs
                    contracts={state.stellar.contractAddresses ?? {}}
                    onSet={setContractAddress}
                    onRemove={removeContractAddress}
                    errors={errors}
                />
            </ConfigSection>

            <div className="flex gap-3 justify-end border-t border-outline-variant/20 pt-6">
                <button
                    type="button"
                    onClick={reset}
                    disabled={!isDirty || isSubmitting}
                    className="px-4 py-2.5 rounded-lg text-sm font-semibold text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Reset
                </button>
                <button
                    type="submit"
                    disabled={!isDirty || isSubmitting}
                    className="primary-gradient text-on-primary px-5 py-2.5 rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                    {isSubmitting ? 'Saving…' : submitLabel}
                </button>
            </div>
        </form>
    );
}

function ConfigSection({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="flex flex-col gap-5">
            <h3 className="text-lg font-bold font-headline text-on-surface">{title}</h3>
            <div className="flex flex-col gap-4">{children}</div>
        </section>
    );
}
