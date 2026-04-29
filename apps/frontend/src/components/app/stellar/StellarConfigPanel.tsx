'use client';

import React, { useState } from 'react';
import type { AssetPair, StellarAsset } from '@craft/types';
import type { StellarConfigFormReturn } from './useStellarConfigForm';

interface StellarConfigPanelProps {
    form: StellarConfigFormReturn;
    onSubmit: () => void;
    submitLabel?: string;
    isSubmitting?: boolean;
}

// ── Network selector ──────────────────────────────────────────────────────────

const HORIZON_DEFAULTS: Record<string, string> = {
    testnet: 'https://horizon-testnet.stellar.org',
    mainnet: 'https://horizon.stellar.org',
};

const SOROBAN_DEFAULTS: Record<string, string> = {
    testnet: 'https://soroban-testnet.stellar.org',
    mainnet: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
};

// ── Main component ────────────────────────────────────────────────────────────

/**
 * StellarConfigPanel — form panel for configuring Stellar network settings.
 *
 * Covers:
 * - Network selection (mainnet / testnet)
 * - Horizon URL with auto-fill from network selection
 * - Soroban RPC URL (optional)
 * - Asset pair management (add / remove)
 * - Contract address management (add / remove)
 *
 * Contextual help text is shown for each Stellar-specific field.
 */
export function StellarConfigPanel({
    form,
    onSubmit,
    submitLabel = 'Save changes',
    isSubmitting = false,
}: StellarConfigPanelProps) {
    const { state, errors, isDirty, setField, setAssetPairs, setContractAddress, removeContractAddress, validate, reset } = form;

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const errs = validate();
        if (errs.length === 0) {
            onSubmit();
        }
    }

    function handleNetworkChange(network: 'mainnet' | 'testnet') {
        setField('network', network);
        // Auto-fill default URLs when switching networks
        if (state.horizonUrl === HORIZON_DEFAULTS[state.network]) {
            setField('horizonUrl', HORIZON_DEFAULTS[network]);
        }
        if (state.sorobanRpcUrl === SOROBAN_DEFAULTS[state.network]) {
            setField('sorobanRpcUrl', SOROBAN_DEFAULTS[network]);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-8" noValidate>
            {/* Network */}
            <ConfigSection title="Network">
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-on-surface-variant">
                        Network
                        <HelpText>
                            Choose <strong>testnet</strong> for development and testing.
                            Switch to <strong>mainnet</strong> only when deploying to production.
                        </HelpText>
                    </label>
                    <div className="flex gap-3" role="radiogroup" aria-label="Stellar network">
                        {(['testnet', 'mainnet'] as const).map((net) => (
                            <label
                                key={net}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer text-sm font-medium transition-colors ${
                                    state.network === net
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low'
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="stellar-network"
                                    value={net}
                                    checked={state.network === net}
                                    onChange={() => handleNetworkChange(net)}
                                    className="sr-only"
                                />
                                {net === 'testnet' ? 'Testnet' : 'Mainnet'}
                            </label>
                        ))}
                    </div>
                    {errors.get('network') && <FieldError>{errors.get('network')}</FieldError>}
                </div>
            </ConfigSection>

            {/* Endpoints */}
            <ConfigSection title="Endpoints">
                <UrlField
                    id="horizon-url"
                    label="Horizon URL"
                    value={state.horizonUrl}
                    onChange={(v) => setField('horizonUrl', v)}
                    error={errors.get('horizonUrl')}
                    help="The Horizon API endpoint for your chosen network. Used for account queries and transaction submission."
                    placeholder={HORIZON_DEFAULTS[state.network]}
                />
                <UrlField
                    id="soroban-rpc-url"
                    label="Soroban RPC URL"
                    value={state.sorobanRpcUrl ?? ''}
                    onChange={(v) => setField('sorobanRpcUrl', v || undefined)}
                    error={errors.get('sorobanRpcUrl')}
                    help="Optional. Required only if your application interacts with Soroban smart contracts."
                    placeholder={SOROBAN_DEFAULTS[state.network]}
                    optional
                />
            </ConfigSection>

            {/* Asset pairs */}
            <ConfigSection title="Asset Pairs">
                <p className="text-sm text-on-surface-variant">
                    Define the trading pairs your application will display. Each pair consists of a base and counter asset.
                    Up to 20 pairs are supported.
                </p>
                <AssetPairList
                    pairs={state.assetPairs ?? []}
                    onChange={setAssetPairs}
                    errors={errors}
                />
            </ConfigSection>

            {/* Contract addresses */}
            <ConfigSection title="Contract Addresses">
                <p className="text-sm text-on-surface-variant">
                    Map contract names to their Soroban contract IDs (56-character addresses starting with <code className="font-mono text-xs bg-surface-container px-1 rounded">C</code>).
                    Leave empty if your application does not use smart contracts.
                </p>
                <ContractAddressList
                    addresses={state.contractAddresses ?? {}}
                    onSet={setContractAddress}
                    onRemove={removeContractAddress}
                    errors={errors}
                />
            </ConfigSection>

            {/* Actions */}
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

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfigSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-5">
            <h3 className="text-lg font-bold font-headline text-on-surface">{title}</h3>
            <div className="flex flex-col gap-4">{children}</div>
        </section>
    );
}

function HelpText({ children }: { children: React.ReactNode }) {
    return <p className="mt-1 text-xs text-on-surface-variant/70">{children}</p>;
}

function FieldError({ children }: { children: React.ReactNode }) {
    return (
        <p role="alert" className="text-xs text-error mt-1">
            {children}
        </p>
    );
}

interface UrlFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    error?: string;
    help: string;
    placeholder?: string;
    optional?: boolean;
}

function UrlField({ id, label, value, onChange, error, help, placeholder, optional }: UrlFieldProps) {
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-medium text-on-surface-variant">
                {label}
                {optional && <span className="ml-1 text-xs text-on-surface-variant/60">(optional)</span>}
            </label>
            <input
                id={id}
                type="url"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
                aria-invalid={!!error}
                className={`w-full rounded-lg border px-3 py-2.5 text-sm bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors ${
                    error ? 'border-error' : 'border-outline-variant/30'
                }`}
            />
            <p id={`${id}-help`} className="text-xs text-on-surface-variant/70">
                {help}
            </p>
            {error && (
                <p id={`${id}-error`} role="alert" className="text-xs text-error">
                    {error}
                </p>
            )}
        </div>
    );
}

// ── Asset pair list ───────────────────────────────────────────────────────────

const EMPTY_ASSET: StellarAsset = { code: '', issuer: '', type: 'credit_alphanum4' };
const EMPTY_PAIR: AssetPair = { base: { ...EMPTY_ASSET }, counter: { ...EMPTY_ASSET } };

interface AssetPairListProps {
    pairs: AssetPair[];
    onChange: (pairs: AssetPair[]) => void;
    errors: Map<string, string>;
}

function AssetPairList({ pairs, onChange, errors }: AssetPairListProps) {
    function addPair() {
        onChange([...pairs, { ...EMPTY_PAIR, base: { ...EMPTY_ASSET }, counter: { ...EMPTY_ASSET } }]);
    }

    function removePair(index: number) {
        onChange(pairs.filter((_, i) => i !== index));
    }

    function updatePair(index: number, side: 'base' | 'counter', field: keyof StellarAsset, value: string) {
        const next = pairs.map((p, i) =>
            i === index ? { ...p, [side]: { ...p[side], [field]: value } } : p
        );
        onChange(next);
    }

    return (
        <div className="flex flex-col gap-3">
            {pairs.map((pair, i) => (
                <div
                    key={i}
                    className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-4 flex flex-col gap-3"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-on-surface">Pair {i + 1}</span>
                        <button
                            type="button"
                            onClick={() => removePair(i)}
                            aria-label={`Remove pair ${i + 1}`}
                            className="text-xs text-error hover:underline"
                        >
                            Remove
                        </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <AssetFields
                            label="Base asset"
                            prefix={`assetPairs.${i}.base`}
                            asset={pair.base}
                            onChange={(field, value) => updatePair(i, 'base', field, value)}
                            errors={errors}
                        />
                        <AssetFields
                            label="Counter asset"
                            prefix={`assetPairs.${i}.counter`}
                            asset={pair.counter}
                            onChange={(field, value) => updatePair(i, 'counter', field, value)}
                            errors={errors}
                        />
                    </div>
                </div>
            ))}
            {pairs.length < 20 && (
                <button
                    type="button"
                    onClick={addPair}
                    className="self-start text-sm text-primary hover:underline font-medium"
                >
                    + Add asset pair
                </button>
            )}
        </div>
    );
}

interface AssetFieldsProps {
    label: string;
    prefix: string;
    asset: StellarAsset;
    onChange: (field: keyof StellarAsset, value: string) => void;
    errors: Map<string, string>;
}

function AssetFields({ label, prefix, asset, onChange, errors }: AssetFieldsProps) {
    const codeError = errors.get(`${prefix}.code`);
    const issuerError = errors.get(`${prefix}.issuer`);

    return (
        <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">{label}</span>
            <div className="flex flex-col gap-1.5">
                <label htmlFor={`${prefix}-type`} className="text-xs text-on-surface-variant">
                    Type
                </label>
                <select
                    id={`${prefix}-type`}
                    value={asset.type}
                    onChange={(e) => onChange('type', e.target.value)}
                    className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                    <option value="native">Native (XLM)</option>
                    <option value="credit_alphanum4">Alphanum-4</option>
                    <option value="credit_alphanum12">Alphanum-12</option>
                </select>
            </div>
            {asset.type !== 'native' && (
                <>
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor={`${prefix}-code`} className="text-xs text-on-surface-variant">
                            Asset code
                        </label>
                        <input
                            id={`${prefix}-code`}
                            type="text"
                            value={asset.code}
                            onChange={(e) => onChange('code', e.target.value)}
                            placeholder={asset.type === 'credit_alphanum4' ? 'e.g. USDC' : 'e.g. LONGCODE'}
                            aria-invalid={!!codeError}
                            className={`rounded-lg border px-3 py-2 text-sm bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                codeError ? 'border-error' : 'border-outline-variant/30'
                            }`}
                        />
                        {codeError && <FieldError>{codeError}</FieldError>}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor={`${prefix}-issuer`} className="text-xs text-on-surface-variant">
                            Issuer account ID
                            <HelpText>The Stellar account that issued this asset (starts with G).</HelpText>
                        </label>
                        <input
                            id={`${prefix}-issuer`}
                            type="text"
                            value={asset.issuer ?? ''}
                            onChange={(e) => onChange('issuer', e.target.value)}
                            placeholder="G…"
                            aria-invalid={!!issuerError}
                            className={`rounded-lg border px-3 py-2 text-sm font-mono bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                issuerError ? 'border-error' : 'border-outline-variant/30'
                            }`}
                        />
                        {issuerError && <FieldError>{issuerError}</FieldError>}
                    </div>
                </>
            )}
        </div>
    );
}

// ── Contract address list ─────────────────────────────────────────────────────

interface ContractAddressListProps {
    addresses: Record<string, string>;
    onSet: (key: string, value: string) => void;
    onRemove: (key: string) => void;
    errors: Map<string, string>;
}

function ContractAddressList({ addresses, onSet, onRemove, errors }: ContractAddressListProps) {
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [addError, setAddError] = useState('');

    const entries = Object.entries(addresses);

    function handleAdd() {
        const key = newKey.trim();
        if (!key) {
            setAddError('Contract name is required');
            return;
        }
        if (key in addresses) {
            setAddError('A contract with this name already exists');
            return;
        }
        setAddError('');
        onSet(key, newValue.trim());
        setNewKey('');
        setNewValue('');
    }

    return (
        <div className="flex flex-col gap-3">
            {entries.map(([key, value]) => {
                const fieldError = errors.get(`contractAddresses.${key}`);
                return (
                    <div key={key} className="flex items-start gap-2">
                        <div className="flex-1 flex flex-col gap-1">
                            <span className="text-xs font-mono text-on-surface-variant">{key}</span>
                            <input
                                type="text"
                                value={value}
                                onChange={(e) => onSet(key, e.target.value)}
                                aria-label={`Contract address for ${key}`}
                                aria-invalid={!!fieldError}
                                className={`w-full rounded-lg border px-3 py-2 text-sm font-mono bg-surface-container-low text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                    fieldError ? 'border-error' : 'border-outline-variant/30'
                                }`}
                            />
                            {fieldError && <FieldError>{fieldError}</FieldError>}
                        </div>
                        <button
                            type="button"
                            onClick={() => onRemove(key)}
                            aria-label={`Remove contract ${key}`}
                            className="mt-5 text-xs text-error hover:underline shrink-0"
                        >
                            Remove
                        </button>
                    </div>
                );
            })}

            {/* Add new contract */}
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-outline-variant/30 p-3">
                <span className="text-xs font-medium text-on-surface-variant">Add contract</span>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newKey}
                        onChange={(e) => { setNewKey(e.target.value); setAddError(''); }}
                        placeholder="Contract name (e.g. amm)"
                        aria-label="New contract name"
                        className="flex-1 rounded-lg border border-outline-variant/30 px-3 py-2 text-sm bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <input
                        type="text"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        placeholder="C… (56 chars)"
                        aria-label="New contract address"
                        className="flex-1 rounded-lg border border-outline-variant/30 px-3 py-2 text-sm font-mono bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <button
                        type="button"
                        onClick={handleAdd}
                        className="px-3 py-2 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/10 transition-colors"
                    >
                        Add
                    </button>
                </div>
                {addError && <FieldError>{addError}</FieldError>}
            </div>
        </div>
    );
}
