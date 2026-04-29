'use client';

import React from 'react';
import type { StellarConfig } from '@craft/types';

interface StellarConfigFormProps {
  value: StellarConfig;
  onChange: (value: StellarConfig) => void;
  errors?: Map<string, string>;
}

const HORIZON_DEFAULTS: Record<'mainnet' | 'testnet', string> = {
  mainnet: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
};

/**
 * Form panel for Stellar network configuration.
 * Handles network selection, Horizon URL, and optional Soroban RPC URL.
 */
export function StellarConfigForm({ value, onChange, errors = new Map() }: StellarConfigFormProps) {
  function set<K extends keyof StellarConfig>(key: K, val: StellarConfig[K]) {
    onChange({ ...value, [key]: val });
  }

  function handleNetworkChange(network: 'mainnet' | 'testnet') {
    onChange({
      ...value,
      network,
      // Auto-fill Horizon URL when switching networks if it still matches the
      // previous default (i.e. the user hasn't customised it).
      horizonUrl:
        value.horizonUrl === HORIZON_DEFAULTS[value.network]
          ? HORIZON_DEFAULTS[network]
          : value.horizonUrl,
    });
  }

  return (
    <section aria-labelledby="stellar-config-heading" className="flex flex-col gap-6">
      <h3 id="stellar-config-heading" className="text-lg font-bold font-headline text-on-surface">
        Stellar Configuration
      </h3>

      {/* Network selector */}
      <fieldset>
        <legend className="text-sm font-medium text-on-surface mb-3">Network</legend>
        <div className="flex gap-3" role="radiogroup" aria-label="Stellar network">
          {(['testnet', 'mainnet'] as const).map((net) => (
            <label
              key={net}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border cursor-pointer text-sm font-semibold transition-all ${
                value.network === net
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-outline-variant/20 text-on-surface-variant hover:border-outline-variant/40'
              }`}
            >
              <input
                type="radio"
                name="stellar-network"
                value={net}
                checked={value.network === net}
                onChange={() => handleNetworkChange(net)}
                className="sr-only"
              />
              {net === 'mainnet' ? '🌐 Mainnet' : '🧪 Testnet'}
            </label>
          ))}
        </div>
        {value.network === 'mainnet' && (
          <p className="mt-2 text-xs text-amber-600 flex items-center gap-1" role="alert">
            <span aria-hidden="true">⚠️</span>
            Mainnet uses real funds. Verify all settings before deploying.
          </p>
        )}
      </fieldset>

      {/* Horizon URL */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="horizon-url" className="text-sm font-medium text-on-surface">
          Horizon URL <span className="text-error" aria-hidden="true">*</span>
        </label>
        <input
          id="horizon-url"
          type="url"
          value={value.horizonUrl}
          onChange={(e) => set('horizonUrl', e.target.value)}
          placeholder={HORIZON_DEFAULTS[value.network]}
          aria-describedby={errors.get('stellar.horizonUrl') ? 'horizon-url-error' : undefined}
          aria-invalid={!!errors.get('stellar.horizonUrl')}
          className={`w-full px-3 py-2.5 rounded-lg border bg-surface-container-lowest text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors ${
            errors.get('stellar.horizonUrl')
              ? 'border-error focus:ring-error/40'
              : 'border-outline-variant/20 focus:border-primary/40'
          }`}
        />
        {errors.get('stellar.horizonUrl') && (
          <p id="horizon-url-error" className="text-xs text-error" role="alert">
            {errors.get('stellar.horizonUrl')}
          </p>
        )}
      </div>

      {/* Soroban RPC URL (optional) */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="soroban-rpc-url" className="text-sm font-medium text-on-surface">
          Soroban RPC URL{' '}
          <span className="text-xs font-normal text-on-surface-variant">(optional)</span>
        </label>
        <input
          id="soroban-rpc-url"
          type="url"
          value={value.sorobanRpcUrl ?? ''}
          onChange={(e) => set('sorobanRpcUrl', e.target.value || undefined)}
          placeholder="https://soroban-testnet.stellar.org"
          aria-describedby={errors.get('stellar.sorobanRpcUrl') ? 'soroban-rpc-error' : undefined}
          aria-invalid={!!errors.get('stellar.sorobanRpcUrl')}
          className={`w-full px-3 py-2.5 rounded-lg border bg-surface-container-lowest text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors ${
            errors.get('stellar.sorobanRpcUrl')
              ? 'border-error focus:ring-error/40'
              : 'border-outline-variant/20 focus:border-primary/40'
          }`}
        />
        {errors.get('stellar.sorobanRpcUrl') && (
          <p id="soroban-rpc-error" className="text-xs text-error" role="alert">
            {errors.get('stellar.sorobanRpcUrl')}
          </p>
        )}
        <p className="text-xs text-on-surface-variant">
          Required only if your template uses Soroban smart contracts.
        </p>
      </div>
    </section>
  );
}
