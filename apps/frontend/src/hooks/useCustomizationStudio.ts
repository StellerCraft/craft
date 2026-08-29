'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { CustomizationConfig } from '@craft/types';

/**
 * Save lifecycle for a customization draft.
 *
 * State transitions:
 * - idle -> saving: a change begins a save attempt.
 * - saving -> saved: the POST resolves successfully and the current draft becomes the saved snapshot.
 * - saving -> error: the POST fails or the request is rejected.
 * - saved -> idle: the success indicator is cleared after a short delay.
 * - error -> idle: a later edit or retry clears the error state.
 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Public contract for the customization studio hook.
 *
 * The hook exposes the current draft, a dirty-check against the last saved
 * snapshot, the save-state machine, and the imperative setters used by the
 * editor UI. `setConfig` updates the draft and schedules the debounced autosave;
 * `save` persists the latest draft immediately and resets the saved snapshot on
 * success.
 */
export interface UseCustomizationStudioReturn {
  config: CustomizationConfig;
  isDirty: boolean;
  saveState: SaveState;
  loadError: string | null;
  loading: boolean;
  setConfig: (config: CustomizationConfig) => void;
  save: (next?: CustomizationConfig) => Promise<void>;
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
 * Manages the customization draft lifecycle from load to save.
 *
 * The hook loads a draft on mount, tracks the current config versus the last
 * saved snapshot, and then follows the normal editor flow: load -> edit ->
 * debounce -> auto-save -> reset to idle after a short success window. Manual
 * saves reuse the same API contract as the debounced autosave, while the
 * debounced path intentionally serializes the latest draft snapshot so the save
 * reflects the user's most recent edit rather than an older closure.
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

/**
 * Persists the hook's current draft to the server.
 *
 * Call this from the explicit save action (for example, the toolbar button).
 * It always saves the latest value in the hook's render closure, cancels any
 * pending debounce timer, and then updates the saved snapshot on success.
 * Pending auto-save work is cleared here so a manual save does not race with a
 * still-scheduled debounced request.
 */
  const save = useCallback(
    async (next?: CustomizationConfig) => {
      const configToSave = next ?? config;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      setSaveState('saving');
      try {
        const res = await fetch(`/api/drafts/${templateId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configToSave),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        if (isMounted.current) {
          setSavedSnapshot(configToSave);
          setSaveState('saved');
          // Reset to idle after 2 s so the "Saved" indicator fades
          setTimeout(() => {
            if (isMounted.current) setSaveState('idle');
          }, 2000);
        }
      } catch {
        if (isMounted.current) setSaveState('error');
      }
    },
    [config, templateId],
  );

/**
 * Updates the draft configuration and schedules an auto-save debounce.
 *
 * Each call resets the pending timer; if a new config arrives before the prior
 * debounce fires, the earlier timer is cancelled and only the newest draft is
 * posted. The delay is controlled by AUTO_SAVE_DELAY_MS and the timer is
 * cancelled on unmount via the isMounted guard and teardown cleanup.
 *
 * The debounced request intentionally posts the `next` snapshot directly rather
 * than calling save() because the timer fires after the render that queued it,
 * and `save()` would otherwise capture the stale closure state from the earlier
 * render. The inline POST mirrors the same POST semantics as `save()` but uses
 * the config snapshot that was current when the debounce fired.
 */
  const setConfig = useCallback(
    (next: CustomizationConfig) => {
      setConfigState(next);
      setSaveState('idle');

      // Debounced auto-save
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
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
