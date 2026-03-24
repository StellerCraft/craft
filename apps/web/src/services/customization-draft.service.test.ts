import { describe, it, expect } from 'vitest';
import { normalizeDraftConfig } from './customization-draft.service';

const full = {
    branding: { appName: 'DEX', primaryColor: '#f00', secondaryColor: '#0f0', fontFamily: 'Mono' },
    features: { enableCharts: false, enableTransactionHistory: false, enableAnalytics: true, enableNotifications: true },
    stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' },
};

describe('normalizeDraftConfig', () => {
    it('returns full config unchanged', () => {
        const result = normalizeDraftConfig(full);
        expect(result.branding.appName).toBe('DEX');
        expect(result.stellar.network).toBe('mainnet');
    });

    it('fills missing branding fields with defaults', () => {
        const result = normalizeDraftConfig({ branding: { appName: 'X' }, features: full.features, stellar: full.stellar });
        expect(result.branding.primaryColor).toBe('#6366f1');
        expect(result.branding.appName).toBe('X');
    });

    it('fills missing features with defaults', () => {
        const result = normalizeDraftConfig({ branding: full.branding, stellar: full.stellar });
        expect(result.features.enableCharts).toBe(true);
    });

    it('fills missing stellar with defaults', () => {
        const result = normalizeDraftConfig({ branding: full.branding, features: full.features });
        expect(result.stellar.network).toBe('testnet');
        expect(result.stellar.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    });

    it('handles null/undefined input gracefully', () => {
        const result = normalizeDraftConfig(null);
        expect(result.branding.fontFamily).toBe('Inter');
        expect(result.features.enableCharts).toBe(true);
    });

    it('handles completely empty object', () => {
        const result = normalizeDraftConfig({});
        expect(result.stellar.network).toBe('testnet');
    });
});
