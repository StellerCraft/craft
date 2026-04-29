'use client';

import React, { useState } from 'react';
import type { CustomizationConfig } from '@craft/types';
import { BrandingForm, useBrandingForm, StellarConfigForm } from '@/components/app/branding';
import type { SaveState } from '@/hooks/useCustomizationStudio';

// ─── Tab definitions ──────────────────────────────────────────────────────────

type TabId = 'branding' | 'stellar';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'branding', label: 'Branding & Features', icon: '🎨' },
  { id: 'stellar', label: 'Stellar Setup', icon: '🌐' },
];

// ─── Save state bar ───────────────────────────────────────────────────────────

const SAVE_STATE_COPY: Record<SaveState, { text: string; className: string }> = {
  idle: { text: '', className: '' },
  saving: { text: 'Saving…', className: 'text-on-surface-variant' },
  saved: { text: '✓ Saved', className: 'text-green-600' },
  error: { text: '⚠ Save failed', className: 'text-error' },
};

interface SaveStateBarProps {
  isDirty: boolean;
  saveState: SaveState;
  onSave: () => void;
}

function SaveStateBar({ isDirty, saveState, onSave }: SaveStateBarProps) {
  const { text, className } = SAVE_STATE_COPY[saveState];
  const isBusy = saveState === 'saving';

  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-2.5 bg-surface-container-low border-b border-outline-variant/10"
      role="status"
      aria-live="polite"
      aria-label="Save status"
    >
      <span className={`text-sm ${className}`}>{text}</span>

      <div className="flex items-center gap-2">
        {isDirty && !isBusy && (
          <span className="text-xs text-on-surface-variant/60 italic">Unsaved changes</span>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || isBusy}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold primary-gradient text-on-primary shadow-sm hover:shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
          aria-label="Save customization"
        >
          {isBusy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─── Mainnet warning banner ───────────────────────────────────────────────────

function MainnetWarning() {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800"
    >
      <span className="text-lg leading-none" aria-hidden="true">⚠️</span>
      <p>
        <strong>Mainnet selected.</strong> Deployments on mainnet use real funds.
        Double-check your Horizon URL and Soroban RPC settings before deploying.
      </p>
    </div>
  );
}

// ─── Progression cues ─────────────────────────────────────────────────────────

interface ProgressionCuesProps {
  config: CustomizationConfig;
}

function ProgressionCues({ config }: ProgressionCuesProps) {
  const steps = [
    {
      label: 'App name set',
      done: config.branding.appName.trim().length > 0,
    },
    {
      label: 'Colors configured',
      done:
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(config.branding.primaryColor) &&
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(config.branding.secondaryColor),
    },
    {
      label: 'Horizon URL set',
      done: config.stellar.horizonUrl.trim().length > 0,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <aside aria-label="Setup progress" className="space-y-2">
      <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">
        Setup progress ({doneCount}/{steps.length})
      </p>
      <ol className="space-y-1.5" role="list">
        {steps.map(({ label, done }) => (
          <li key={label} className="flex items-center gap-2 text-sm">
            <span
              className={`w-4 h-4 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                done ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
              }`}
              aria-hidden="true"
            >
              {done ? '✓' : '○'}
            </span>
            <span className={done ? 'text-on-surface' : 'text-on-surface-variant'}>{label}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface CustomizationStudioProps {
  config: CustomizationConfig;
  isDirty: boolean;
  saveState: SaveState;
  onChange: (config: CustomizationConfig) => void;
  onSave: () => void;
  onDeploy: () => void;
}

/**
 * Customization studio layout.
 *
 * Desktop (lg+): two-column — editor panels left, progression sidebar right.
 * Mobile/tablet: single column with tab navigation between panels.
 *
 * Panels:
 *  - Branding & Features (BrandingForm)
 *  - Stellar Setup (StellarConfigForm)
 *
 * Persistent elements:
 *  - SaveStateBar (top of editor area)
 *  - MainnetWarning (when mainnet is selected)
 *  - ProgressionCues sidebar
 *  - Deploy CTA (enabled only when all required fields are complete)
 */
export function CustomizationStudio({
  config,
  isDirty,
  saveState,
  onChange,
  onSave,
  onDeploy,
}: CustomizationStudioProps) {
  const [activeTab, setActiveTab] = useState<TabId>('branding');

  const brandingFormState = {
    branding: config.branding,
    features: config.features,
  };

  const brandingForm = useBrandingForm(brandingFormState);

  // Sync branding form changes back to the studio config
  function handleBrandingSubmit() {
    onChange({ ...config, branding: brandingForm.state.branding, features: brandingForm.state.features });
    onSave();
  }

  function handleStellarChange(stellar: CustomizationConfig['stellar']) {
    onChange({ ...config, stellar });
  }

  const isMainnet = config.stellar.network === 'mainnet';
  const canDeploy =
    config.branding.appName.trim().length > 0 &&
    config.stellar.horizonUrl.trim().length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Save state bar */}
      <SaveStateBar isDirty={isDirty} saveState={saveState} onSave={onSave} />

      {/* Mainnet warning */}
      {isMainnet && (
        <div className="px-4 pt-3">
          <MainnetWarning />
        </div>
      )}

      {/* Tab navigation (visible on all sizes; on lg the sidebar is always shown) */}
      <div
        className="flex border-b border-outline-variant/10 px-4 pt-3 gap-1"
        role="tablist"
        aria-label="Customization panels"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Editor panels */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div
            id="panel-branding"
            role="tabpanel"
            aria-labelledby="tab-branding"
            hidden={activeTab !== 'branding'}
          >
            <BrandingForm
              form={brandingForm}
              onSubmit={handleBrandingSubmit}
              submitLabel="Save branding"
            />
          </div>

          <div
            id="panel-stellar"
            role="tabpanel"
            aria-labelledby="tab-stellar"
            hidden={activeTab !== 'stellar'}
          >
            <StellarConfigForm value={config.stellar} onChange={handleStellarChange} />
          </div>
        </div>

        {/* Sidebar: progression + deploy CTA */}
        <aside className="hidden lg:flex flex-col w-56 flex-shrink-0 border-l border-outline-variant/10 p-4 gap-6 overflow-y-auto">
          <ProgressionCues config={config} />

          <div className="mt-auto">
            <button
              type="button"
              onClick={onDeploy}
              disabled={!canDeploy}
              className="w-full primary-gradient text-on-primary px-4 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 text-sm"
              aria-label="Deploy this customization"
              aria-disabled={!canDeploy}
            >
              Deploy
            </button>
            {!canDeploy && (
              <p className="text-xs text-on-surface-variant/60 mt-2 text-center">
                Complete required fields to deploy
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile deploy bar */}
      <div className="lg:hidden border-t border-outline-variant/10 p-4">
        <button
          type="button"
          onClick={onDeploy}
          disabled={!canDeploy}
          className="w-full primary-gradient text-on-primary px-4 py-3 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          aria-label="Deploy this customization"
          aria-disabled={!canDeploy}
        >
          Deploy
        </button>
      </div>
    </div>
  );
}
