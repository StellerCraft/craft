'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { CustomizationConfig } from '@craft/types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface UseCustomizationStudioReturn {
  config: CustomizationConfig;
  isDirty: boolean;
  saveState: SaveState;
  loadError: string | null;
  loading: boolean;
  setConfig: (config: CustomizationConfig) => void;
  save: () => Promise<void>;
}

const DEFAULT_CONFIG: CustomizationConfig = {
  branding: {
    appName: '',
    primaryColor: '#6366f1',
    secondaryColor: '#a5b4fc',
    fontFamily: 'Inter',
  },
  features: {
    enableCharts: true,
    enableTransactionHistory: true,
    enableAnalytics: false,
    enableNotifications: false,
  },
  stellar: {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
};

const AUTO_SAVE_DELAY_MS = 2000;

/**
 * Manages the full lifecycle of a customization draft:
 * - Loads the existing draft from the API on mount
 * - Tracks dirty state against the last-saved snapshot
 * - Exposes an explicit save() and auto-saves after a debounce period
 */
export function useCustomizationStudio(templateId: string): UseCustomizationStudioReturn {
  const [config, setConfigState] = useState<CustomizationConfig>(DEFAULT_CONFIG);
  const [savedSnapshot, setSavedSnapshot] = useState<CustomizationConfig>(DEFAULT_CONFIG);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  // Load draft on mount
  useEffect(() => {
    isMounted.current = true;
    let cancelled = false;

    async function loadDraft() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/drafts/${templateId}`);
        if (res.status === 404) {
          // No draft yet — use defaults
          if (!cancelled) setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`Failed to load draft (${res.status})`);
        const draft = await res.json();
        if (!cancelled) {
          const cfg: CustomizationConfig = draft.customizationConfig ?? DEFAULT_CONFIG;
          setConfigState(cfg);
          setSavedSnapshot(cfg);
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message ?? 'Failed to load draft');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDraft();
    return () => {
      cancelled = true;
      isMounted.current = false;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [templateId]);

  const isDirty = JSON.stringify(config) !== JSON.stringify(savedSnapshot);

  const save = useCallback(async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveState('saving');
    try {
      const res = await fetch(`/api/drafts/${templateId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      if (isMounted.current) {
        setSavedSnapshot(config);
        setSaveState('saved');
        // Reset to idle after 2 s so the "Saved" indicator fades
        setTimeout(() => {
          if (isMounted.current) setSaveState('idle');
        }, 2000);
      }
    } catch {
      if (isMounted.current) setSaveState('error');
    }
  }, [config, templateId]);

  const setConfig = useCallback(
    (next: CustomizationConfig) => {
      setConfigState(next);
      setSaveState('idle');

      // Debounced auto-save
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        // Use the latest config via a ref-free approach: call save() which
        // closes over the current `config` — but since setConfig is called
        // before the timer fires, we need to trigger save with `next` directly.
        setSaveState('saving');
        fetch(`/api/drafts/${templateId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        })
          .then((res) => {
            if (!res.ok) throw new Error();
            if (isMounted.current) {
              setSavedSnapshot(next);
              setSaveState('saved');
              setTimeout(() => {
                if (isMounted.current) setSaveState('idle');
              }, 2000);
            }
          })
          .catch(() => {
            if (isMounted.current) setSaveState('error');
          });
      }, AUTO_SAVE_DELAY_MS);
    },
    [templateId],
  );

  return { config, isDirty, saveState, loadError, loading, setConfig, save };
}
