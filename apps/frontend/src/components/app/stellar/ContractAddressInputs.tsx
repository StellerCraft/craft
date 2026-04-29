'use client';

import React, { useState } from 'react';
import { validateContractAddress } from '@/lib/stellar/contract-validation';

interface ContractAddressInputsProps {
    contracts: Record<string, string>;
    onSet: (name: string, address: string) => void;
    onRemove: (name: string) => void;
    /** Field-level errors keyed by `stellar.contractAddresses.<name>` */
    errors?: Map<string, string>;
}

export function ContractAddressInputs({
    contracts,
    onSet,
    onRemove,
    errors,
}: ContractAddressInputsProps) {
    const [newName, setNewName] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [addError, setAddError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    function handleAdd() {
        const trimmedName = newName.trim();
        const trimmedAddress = newAddress.trim();

        if (!trimmedName) {
            setAddError('Contract name is required');
            return;
        }
        if (trimmedName in contracts) {
            setAddError(`A contract named "${trimmedName}" already exists`);
            return;
        }
        const result = validateContractAddress(trimmedAddress);
        if (!result.valid) {
            setAddError(result.reason);
            return;
        }

        onSet(trimmedName, trimmedAddress);
        setNewName('');
        setNewAddress('');
        setAddError(null);
        setOpen(false);
    }

    const entries = Object.entries(contracts);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-on-surface">Contract Addresses</span>
                <button
                    type="button"
                    onClick={() => {
                        setOpen((v) => !v);
                        setAddError(null);
                    }}
                    aria-expanded={open}
                    className="text-xs px-2.5 py-1 rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low transition-colors"
                >
                    {open ? 'Cancel' : '+ Add contract'}
                </button>
            </div>

            {entries.length > 0 && (
                <ul className="flex flex-col gap-2" aria-label="Contract addresses">
                    {entries.map(([name, address]) => {
                        const fieldError = errors?.get(`stellar.contractAddresses.${name}`);
                        return (
                            <li key={name} className="flex flex-col gap-0.5">
                                <div className="flex items-center justify-between rounded-lg border border-outline-variant/20 px-3 py-2 bg-surface-container-lowest">
                                    <div className="flex flex-col gap-0.5 min-w-0">
                                        <span className="text-xs font-semibold text-on-surface">{name}</span>
                                        <span className="text-xs font-mono text-on-surface-variant truncate">
                                            {address}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => onRemove(name)}
                                        aria-label={`Remove contract ${name}`}
                                        className="text-on-surface-variant hover:text-error transition-colors text-xs ml-2 shrink-0"
                                    >
                                        ✕
                                    </button>
                                </div>
                                {fieldError && (
                                    <p role="alert" className="text-xs text-error pl-1">
                                        {fieldError}
                                    </p>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {entries.length === 0 && !open && (
                <p className="text-xs text-on-surface-variant">No contract addresses configured.</p>
            )}

            {open && (
                <div className="rounded-lg border border-outline-variant/30 p-4 bg-surface-container-low flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="contract-name" className="text-xs font-medium text-on-surface">
                            Contract name
                        </label>
                        <input
                            id="contract-name"
                            type="text"
                            value={newName}
                            onChange={(e) => {
                                setNewName(e.target.value);
                                setAddError(null);
                            }}
                            placeholder="e.g. amm_pool"
                            className="rounded border border-outline-variant/30 px-3 py-1.5 text-sm bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant/50"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="contract-address" className="text-xs font-medium text-on-surface">
                            Contract address
                        </label>
                        <input
                            id="contract-address"
                            type="text"
                            value={newAddress}
                            onChange={(e) => {
                                setNewAddress(e.target.value);
                                setAddError(null);
                            }}
                            placeholder="C…"
                            className="rounded border border-outline-variant/30 px-3 py-1.5 text-sm font-mono bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant/50"
                        />
                    </div>
                    {addError && (
                        <p role="alert" className="text-xs text-error">
                            {addError}
                        </p>
                    )}
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={handleAdd}
                            disabled={!newName || !newAddress}
                            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-on-primary primary-gradient shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            Add contract
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
