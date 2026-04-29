'use client';

import React, { useState } from 'react';
import type { AssetPair, StellarAsset, StellarAssetType } from '@craft/types';

interface AssetPairEditorProps {
    pairs: AssetPair[];
    onAdd: (pair: AssetPair) => void;
    onRemove: (index: number) => void;
    error?: string;
}

const EMPTY_ASSET: StellarAsset = { code: '', issuer: '', type: 'credit_alphanum4' };
const EMPTY_PAIR: AssetPair = { base: { ...EMPTY_ASSET }, counter: { ...EMPTY_ASSET } };

function assetLabel(asset: StellarAsset): string {
    if (asset.type === 'native') return 'XLM (native)';
    return asset.issuer ? `${asset.code}:${asset.issuer.slice(0, 8)}…` : asset.code;
}

function AssetFields({
    prefix,
    asset,
    onChange,
}: {
    prefix: string;
    asset: StellarAsset;
    onChange: (a: StellarAsset) => void;
}) {
    const isNative = asset.type === 'native';
    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-center">
                <label htmlFor={`${prefix}-type`} className="text-xs text-on-surface-variant w-12 shrink-0">
                    Type
                </label>
                <select
                    id={`${prefix}-type`}
                    value={asset.type}
                    onChange={(e) =>
                        onChange({
                            ...asset,
                            type: e.target.value as StellarAssetType,
                            code: e.target.value === 'native' ? 'XLM' : asset.code,
                            issuer: e.target.value === 'native' ? '' : asset.issuer,
                        })
                    }
                    className="flex-1 rounded border border-outline-variant/30 px-2 py-1 text-xs bg-surface-container-lowest text-on-surface"
                >
                    <option value="native">Native (XLM)</option>
                    <option value="credit_alphanum4">Alphanum-4</option>
                    <option value="credit_alphanum12">Alphanum-12</option>
                </select>
            </div>
            {!isNative && (
                <>
                    <div className="flex gap-2 items-center">
                        <label htmlFor={`${prefix}-code`} className="text-xs text-on-surface-variant w-12 shrink-0">
                            Code
                        </label>
                        <input
                            id={`${prefix}-code`}
                            type="text"
                            value={asset.code}
                            onChange={(e) => onChange({ ...asset, code: e.target.value.toUpperCase() })}
                            placeholder="USDC"
                            maxLength={12}
                            className="flex-1 rounded border border-outline-variant/30 px-2 py-1 text-xs bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant/50"
                        />
                    </div>
                    <div className="flex gap-2 items-center">
                        <label htmlFor={`${prefix}-issuer`} className="text-xs text-on-surface-variant w-12 shrink-0">
                            Issuer
                        </label>
                        <input
                            id={`${prefix}-issuer`}
                            type="text"
                            value={asset.issuer}
                            onChange={(e) => onChange({ ...asset, issuer: e.target.value })}
                            placeholder="G…"
                            className="flex-1 rounded border border-outline-variant/30 px-2 py-1 text-xs bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant/50 font-mono"
                        />
                    </div>
                </>
            )}
        </div>
    );
}

export function AssetPairEditor({ pairs, onAdd, onRemove, error }: AssetPairEditorProps) {
    const [draft, setDraft] = useState<AssetPair>(EMPTY_PAIR);
    const [open, setOpen] = useState(false);

    function handleAdd() {
        onAdd(draft);
        setDraft(EMPTY_PAIR);
        setOpen(false);
    }

    const canAdd =
        (draft.base.type === 'native' || (draft.base.code && draft.base.issuer)) &&
        (draft.counter.type === 'native' || (draft.counter.code && draft.counter.issuer));

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-on-surface">Asset Pairs</span>
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-expanded={open}
                    className="text-xs px-2.5 py-1 rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                    {open ? 'Cancel' : '+ Add pair'}
                </button>
            </div>

            {error && (
                <p role="alert" className="text-xs text-error">
                    {error}
                </p>
            )}

            {pairs.length > 0 && (
                <ul className="flex flex-col gap-1.5" aria-label="Asset pairs">
                    {pairs.map((pair, i) => (
                        <li
                            key={i}
                            className="flex items-center justify-between rounded-lg border border-outline-variant/20 px-3 py-2 bg-surface-container-lowest text-sm"
                        >
                            <span className="text-on-surface font-mono text-xs">
                                {assetLabel(pair.base)} / {assetLabel(pair.counter)}
                            </span>
                            <button
                                type="button"
                                onClick={() => onRemove(i)}
                                aria-label={`Remove pair ${assetLabel(pair.base)} / ${assetLabel(pair.counter)}`}
                                className="text-on-surface-variant hover:text-error transition-colors text-xs ml-2"
                            >
                                ✕
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {pairs.length === 0 && !open && (
                <p className="text-xs text-on-surface-variant">No asset pairs configured.</p>
            )}

            {open && (
                <div className="rounded-lg border border-outline-variant/30 p-4 bg-surface-container-low flex flex-col gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">
                                Base asset
                            </span>
                            <AssetFields
                                prefix="base"
                                asset={draft.base}
                                onChange={(a) => setDraft((d) => ({ ...d, base: a }))}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">
                                Counter asset
                            </span>
                            <AssetFields
                                prefix="counter"
                                asset={draft.counter}
                                onChange={(a) => setDraft((d) => ({ ...d, counter: a }))}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={handleAdd}
                            disabled={!canAdd}
                            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-on-primary primary-gradient shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            Add pair
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
