import { describe, it, expect } from 'vitest';
import type { CustomizationConfig, StellarMockData } from '@craft/types';
import {
    generatePreviewCss,
    generatePreviewHtml,
    generatePreviewAssets,
    transformPreview,
} from './html-transform';
import type { ViewportClass } from '@/services/preview.service';

const mockConfig: CustomizationConfig = {
    branding: {
        appName: 'Test DEX',
        primaryColor: '#3b82f6',
        secondaryColor: '#1e40af',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: true,
        enableAnalytics: true,
        enableNotifications: true,
    },
    stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
    },
};

const mockData: StellarMockData = {
    accountBalance: '10000.1234567',
    recentTransactions: [
        { id: 'tx-001', type: 'payment', amount: '100.0000000', asset: { code: 'XLM', issuer: '', type: 'native' }, timestamp: new Date('2024-01-15T10:00:00Z') },
        { id: 'tx-002', type: 'swap', amount: '50.0000000', asset: { code: 'XLM', issuer: '', type: 'native' }, timestamp: new Date('2024-01-14T09:00:00Z') },
    ],
    assetPrices: { XLM: 0.12, USDC: 1.0 },
};

describe('html-transform', () => {
    describe('generatePreviewCss', () => {
        it('should generate CSS with branding tokens', () => {
            const css = generatePreviewCss(mockConfig, 'desktop');
            
            expect(css).toContain('--craft-primary: #3b82f6');
            expect(css).toContain('--craft-secondary: #1e40af');
            expect(css).toContain('--craft-font-family: Inter');
        });

        it('should include viewport dimensions', () => {
            const desktopCss = generatePreviewCss(mockConfig, 'desktop');
            const mobileCss = generatePreviewCss(mockConfig, 'mobile');
            
            expect(desktopCss).toContain('--craft-viewport-width: 1440px');
            expect(mobileCss).toContain('--craft-viewport-width: 375px');
        });

        it('should include feature flags as CSS variables', () => {
            const css = generatePreviewCss(mockConfig, 'desktop');
            
            expect(css).toContain('--craft-feature-charts: 1');
            expect(css).toContain('--craft-feature-transactions: 1');
            expect(css).toContain('--craft-feature-analytics: 1');
            expect(css).toContain('--craft-feature-notifications: 1');
        });

        it('should set disabled features to 0', () => {
            const disabledConfig: CustomizationConfig = {
                ...mockConfig,
                features: {
                    enableCharts: false,
                    enableTransactionHistory: false,
                    enableAnalytics: false,
                    enableNotifications: false,
                },
            };
            
            const css = generatePreviewCss(disabledConfig, 'desktop');
            
            expect(css).toContain('--craft-feature-charts: 0');
            expect(css).toContain('--craft-feature-transactions: 0');
        });

        it('should include RGB values for primary and secondary colors', () => {
            const css = generatePreviewCss(mockConfig, 'desktop');
            
            expect(css).toContain('--craft-primary-rgb:');
            expect(css).toContain('--craft-secondary-rgb:');
        });

        it('should include derived color variables', () => {
            const css = generatePreviewCss(mockConfig, 'desktop');
            
            expect(css).toContain('--craft-surface:');
            expect(css).toContain('--craft-text-primary:');
            expect(css).toContain('--craft-text-secondary:');
        });

        it('should have responsive base styles', () => {
            const css = generatePreviewCss(mockConfig, 'desktop');
            
            expect(css).toContain('@media (max-width: 768px)');
            expect(css).toContain('.craft-header');
            expect(css).toContain('.craft-preview-container');
        });
    });

    describe('generatePreviewHtml', () => {
        it('should generate valid HTML document', () => {
            const html = generatePreviewHtml(mockConfig, mockData, 'desktop');
            
            expect(html).toContain('<!DOCTYPE html>');
            expect(html).toContain('<html lang="en">');
            expect(html).toContain('</html>');
        });

        it('should include app name in title and header', () => {
            const html = generatePreviewHtml(mockConfig, mockData, 'desktop');
            
            expect(html).toContain('<title>Test DEX - Preview</title>');
            expect(html).toContain('Test DEX');
        });

        it('should include embedded CSS', () => {
            const html = generatePreviewHtml(mockConfig, mockData, 'desktop');
            
            expect(html).toContain('<style>');
            expect(html).toContain('</style>');
            expect(html).toContain('--craft-primary');
        });

        it('should display account balance', () => {
            const html = generatePreviewHtml(mockConfig, mockData, 'desktop');
            
            expect(html).toContain('10000.1234567 XLM');
        });

        it('should display recent transactions when enabled', () => {
            const html = generatePreviewHtml(mockConfig, mockData, 'desktop');
            
            expect(html).toContain('Recent Transactions');
            expect(html).toContain('tx-001');
            expect(html).toContain('tx-002');
            expect(html).toContain('payment');
            expect(html).toContain('swap');
        });

        it('should display asset prices', () => {
            const html = generatePreviewHtml(mockConfig, mockData, 'desktop');
            
            expect(html).toContain('Asset Prices');
            expect(html).toContain('XLM');
            expect(html).toContain('USDC');
            expect(html).toContain('$0.12');
            expect(html).toContain('$1.00');
        });

        it('should include feature-flag controlled sections', () => {
            const html = generatePreviewHtml(mockConfig, mockData, 'desktop');
            
            expect(html).toContain('data-feature="charts"');
            expect(html).toContain('data-feature="transactions"');
            expect(html).toContain('data-feature="analytics"');
            expect(html).toContain('data-feature="notifications"');
        });

        it('should escape HTML entities in app name', () => {
            const configWithXSS: CustomizationConfig = {
                ...mockConfig,
                branding: {
                    ...mockConfig.branding,
                    appName: '<script>alert("xss")</script>',
                },
            };
            
            const html = generatePreviewHtml(configWithXSS, mockData, 'desktop');
            
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;');
        });

        it('should escape HTML entities in transaction data', () => {
            const xssMockData: StellarMockData = {
                ...mockData,
                recentTransactions: [
                    { 
                        id: 'tx-<script>evil</script>', 
                        type: 'payment<img src=x onerror=alert(1)>', 
                        amount: '100', 
                        asset: { code: 'XLM<img>', issuer: '', type: 'native' }, 
                        timestamp: new Date() 
                    },
                ],
            };
            
            const html = generatePreviewHtml(mockConfig, xssMockData, 'desktop');
            
            expect(html).not.toContain('<script>');
            expect(html).not.toContain('<img');
            expect(html).toContain('&lt;script&gt;');
            expect(html).toContain('&lt;img');
        });

        it('should generate responsive viewport meta tag', () => {
            const html = generatePreviewHtml(mockConfig, mockData, 'desktop');
            
            expect(html).toContain('content="width=1440, initial-scale=1.0"');
        });

        it('should include logo letter from app name', () => {
            const html = generatePreviewHtml(mockConfig, mockData, 'desktop');
            
            expect(html).toContain('class="craft-logo"');
            expect(html).toContain('T'); // First letter of "Test DEX"
        });
    });

    describe('generatePreviewAssets', () => {
        it('should return empty array when no logo URL', () => {
            const assets = generatePreviewAssets(mockConfig);
            
            expect(assets).toEqual([]);
        });

        it('should include logo asset when logoUrl is provided', () => {
            const configWithLogo: CustomizationConfig = {
                ...mockConfig,
                branding: {
                    ...mockConfig.branding,
                    logoUrl: 'https://example.com/logo.png',
                },
            };
            
            const assets = generatePreviewAssets(configWithLogo);
            
            expect(assets).toHaveLength(1);
            expect(assets[0]).toEqual({
                url: 'https://example.com/logo.png',
                type: 'image',
            });
        });

        it('should include font asset for non-system fonts', () => {
            const configWithCustomFont: CustomizationConfig = {
                ...mockConfig,
                branding: {
                    ...mockConfig.branding,
                    fontFamily: 'Roboto',
                },
            };
            
            const assets = generatePreviewAssets(configWithCustomFont);
            
            expect(assets.some(a => a.type === 'font')).toBe(true);
            expect(assets.some(a => a.url.includes('fonts.googleapis.com'))).toBe(true);
        });

        it('should not include font asset for system fonts', () => {
            const configWithSystemFont: CustomizationConfig = {
                ...mockConfig,
                branding: {
                    ...mockConfig.branding,
                    fontFamily: 'Arial, sans-serif',
                },
            };
            
            const assets = generatePreviewAssets(configWithSystemFont);
            
            expect(assets.every(a => a.type !== 'font')).toBe(true);
        });
    });

    describe('transformPreview', () => {
        it('should return complete preview data', () => {
            const result = transformPreview(mockConfig, mockData, 'desktop');
            
            expect(result.html).toBeDefined();
            expect(result.css).toBeDefined();
            expect(result.assets).toBeDefined();
            expect(typeof result.html).toBe('string');
            expect(typeof result.css).toBe('string');
            expect(Array.isArray(result.assets)).toBe(true);
        });

        it('should generate consistent CSS between transformPreview and generatePreviewCss', () => {
            const result = transformPreview(mockConfig, mockData, 'desktop');
            const css = generatePreviewCss(mockConfig, 'desktop');
            
            expect(result.css).toBe(css);
        });
    });

    describe('viewport-specific generation', () => {
        it('should generate different spacing for different viewports', () => {
            const desktopCss = generatePreviewCss(mockConfig, 'desktop');
            const mobileCss = generatePreviewCss(mockConfig, 'mobile');
            
            expect(desktopCss).toContain('--craft-spacing-unit: 16px');
            expect(mobileCss).toContain('--craft-spacing-unit: 8px');
        });

        it('should generate different border radius for different viewports', () => {
            const desktopCss = generatePreviewCss(mockConfig, 'desktop');
            const tabletCss = generatePreviewCss(mockConfig, 'tablet');
            const mobileCss = generatePreviewCss(mockConfig, 'mobile');
            
            expect(desktopCss).toContain('--craft-border-radius: 12px');
            expect(tabletCss).toContain('--craft-border-radius: 10px');
            expect(mobileCss).toContain('--craft-border-radius: 8px');
        });
    });

    describe('feature-flag driven layout', () => {
        it('should include all sections regardless of feature flags', () => {
            // Sections are always rendered, CSS controls visibility
            const disabledConfig: CustomizationConfig = {
                ...mockConfig,
                features: {
                    enableCharts: false,
                    enableTransactionHistory: false,
                    enableAnalytics: false,
                    enableNotifications: false,
                },
            };
            
            const html = generatePreviewHtml(disabledConfig, mockData, 'desktop');
            
            expect(html).toContain('Charts');
            expect(html).toContain('Recent Transactions');
            expect(html).toContain('Analytics');
            expect(html).toContain('Notifications');
        });

        it('should have proper CSS display rules for feature sections', () => {
            const disabledConfig: CustomizationConfig = {
                ...mockConfig,
                features: {
                    enableCharts: false,
                    enableTransactionHistory: true,
                    enableAnalytics: false,
                    enableNotifications: false,
                },
            };
            
            const css = generatePreviewCss(disabledConfig, 'desktop');
            
            expect(css).toContain('[data-feature="charts"]');
            expect(css).toContain('display: var(--craft-feature-charts, none)');
        });
    });
});
