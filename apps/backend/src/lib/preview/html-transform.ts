import type { CustomizationConfig, StellarMockData, PreviewAsset } from '@craft/types';
import type { ViewportClass } from '@/services/preview.service';

/**
 * HTML/CSS Transformation Utilities
 * 
 * Generates secure, isolated preview HTML and CSS based on customization config.
 * Supports feature-flag-driven layout changes and applies branding tokens.
 */

export interface TransformOptions {
    viewport: ViewportClass;
    featureFlags?: Record<string, boolean>;
}

interface HtmlSection {
    id: string;
    featureFlag?: keyof CustomizationConfig['features'];
    render: (config: CustomizationConfig, mockData: StellarMockData) => string;
}

/**
 * CSS variable definitions for branding tokens
 */
function generateCssVariables(config: CustomizationConfig, viewport: ViewportClass): string {
    const { branding, features } = config;
    
    return `
        :root {
            /* Branding Tokens */
            --craft-primary: ${branding.primaryColor};
            --craft-primary-rgb: ${hexToRgb(branding.primaryColor)};
            --craft-secondary: ${branding.secondaryColor};
            --craft-secondary-rgb: ${hexToRgb(branding.secondaryColor)};
            --craft-font-family: ${escapeCssString(branding.fontFamily)};
            --craft-app-name: "${escapeCssString(branding.appName)}";
            
            /* Layout Tokens */
            --craft-viewport-width: ${getViewportWidth(viewport)}px;
            --craft-viewport-height: ${getViewportHeight(viewport)}px;
            --craft-spacing-unit: ${getSpacingUnit(viewport)}px;
            --craft-border-radius: ${getBorderRadius(viewport)}px;
            
            /* Feature Flags as CSS Custom Properties */
            --craft-feature-charts: ${features.enableCharts ? '1' : '0'};
            --craft-feature-transactions: ${features.enableTransactionHistory ? '1' : '0'};
            --craft-feature-analytics: ${features.enableAnalytics ? '1' : '0'};
            --craft-feature-notifications: ${features.enableNotifications ? '1' : '0'};
            
            /* Derived Colors */
            --craft-surface: color-mix(in srgb, ${branding.primaryColor} 5%, white);
            --craft-surface-elevated: color-mix(in srgb, ${branding.primaryColor} 8%, white);
            --craft-text-primary: color-mix(in srgb, ${branding.primaryColor} 80%, black);
            --craft-text-secondary: color-mix(in srgb, ${branding.secondaryColor} 60%, #666);
        }
    `.trim();
}

/**
 * Base CSS styles for preview
 */
function generateBaseStyles(): string {
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--craft-font-family), system-ui, -apple-system, sans-serif;
            background: linear-gradient(135deg, var(--craft-surface) 0%, var(--craft-secondary) 100%);
            color: var(--craft-text-primary);
            min-height: 100vh;
            line-height: 1.6;
        }
        
        .craft-preview-container {
            width: var(--craft-viewport-width);
            min-height: var(--craft-viewport-height);
            margin: 0 auto;
            background: var(--craft-surface);
            box-shadow: 0 0 50px rgba(var(--craft-primary-rgb), 0.1);
        }
        
        .craft-header {
            background: var(--craft-primary);
            color: white;
            padding: calc(var(--craft-spacing-unit) * 2);
            display: flex;
            align-items: center;
            gap: var(--craft-spacing-unit);
        }
        
        .craft-logo {
            width: 40px;
            height: 40px;
            border-radius: var(--craft-border-radius);
            background: rgba(255,255,255,0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 1.2rem;
        }
        
        .craft-app-title {
            font-size: 1.5rem;
            font-weight: 600;
            letter-spacing: -0.02em;
        }
        
        .craft-main {
            padding: calc(var(--craft-spacing-unit) * 2);
        }
        
        .craft-section {
            display: block;
            margin-bottom: calc(var(--craft-spacing-unit) * 2);
            padding: calc(var(--craft-spacing-unit) * 1.5);
            background: var(--craft-surface-elevated);
            border-radius: var(--craft-border-radius);
            border: 1px solid rgba(var(--craft-primary-rgb), 0.1);
        }
        
        /* Feature-flag controlled visibility */
        .craft-section[data-feature="charts"] {
            display: var(--craft-feature-charts, none);
        }
        
        .craft-section[data-feature="transactions"] {
            display: var(--craft-feature-transactions, none);
        }
        
        .craft-section[data-feature="analytics"] {
            display: var(--craft-feature-analytics, none);
        }
        
        .craft-section[data-feature="notifications"] {
            display: var(--craft-feature-notifications, none);
        }
        
        .craft-section-title {
            font-size: 0.875rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--craft-text-secondary);
            margin-bottom: var(--craft-spacing-unit);
        }
        
        .craft-card {
            background: white;
            border-radius: var(--craft-border-radius);
            padding: var(--craft-spacing-unit);
            box-shadow: 0 2px 8px rgba(0,0,0,0.04);
            margin-bottom: var(--craft-spacing-unit);
        }
        
        .craft-balance {
            font-size: 2rem;
            font-weight: 700;
            color: var(--craft-primary);
        }
        
        .craft-transaction-list {
            list-style: none;
        }
        
        .craft-transaction-item {
            display: flex;
            justify-content: space-between;
            padding: calc(var(--craft-spacing-unit) * 0.75) 0;
            border-bottom: 1px solid rgba(var(--craft-primary-rgb), 0.08);
        }
        
        .craft-transaction-item:last-child {
            border-bottom: none;
        }
        
        .craft-price-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: var(--craft-spacing-unit);
        }
        
        .craft-price-item {
            text-align: center;
            padding: var(--craft-spacing-unit);
        }
        
        .craft-price-label {
            font-size: 0.75rem;
            color: var(--craft-text-secondary);
            text-transform: uppercase;
        }
        
        .craft-price-value {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--craft-primary);
        }
        
        /* Responsive adjustments */
        @media (max-width: 768px) {
            .craft-header {
                padding: var(--craft-spacing-unit);
            }
            
            .craft-app-title {
                font-size: 1.25rem;
            }
            
            .craft-main {
                padding: var(--craft-spacing-unit);
            }
        }
    `.trim();
}

/**
 * Section renderers for feature-flag-driven layout
 */
const SECTIONS: HtmlSection[] = [
    {
        id: 'balance',
        render: (config, mockData) => `
            <section class="craft-section">
                <h2 class="craft-section-title">Account Balance</h2>
                <div class="craft-card">
                    <div class="craft-balance">${escapeHtml(mockData.accountBalance)} XLM</div>
                </div>
            </section>
        `,
    },
    {
        id: 'charts',
        featureFlag: 'enableCharts',
        render: () => `
            <section class="craft-section" data-feature="charts">
                <h2 class="craft-section-title">Charts</h2>
                <div class="craft-card">
                    <div style="height: 150px; background: linear-gradient(90deg, var(--craft-primary) 0%, transparent 100%); opacity: 0.3; border-radius: 4px;"></div>
                </div>
            </section>
        `,
    },
    {
        id: 'transactions',
        featureFlag: 'enableTransactionHistory',
        render: (config, mockData) => `
            <section class="craft-section" data-feature="transactions">
                <h2 class="craft-section-title">Recent Transactions</h2>
                <div class="craft-card">
                    <ul class="craft-transaction-list">
                        ${mockData.recentTransactions.map(tx => `
                            <li class="craft-transaction-item">
                                <span>${escapeHtml(tx.type)} - ${escapeHtml(tx.id.slice(-6))}</span>
                                <span>${escapeHtml(tx.amount)} ${escapeHtml(tx.asset.code)}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            </section>
        `,
    },
    {
        id: 'analytics',
        featureFlag: 'enableAnalytics',
        render: () => `
            <section class="craft-section" data-feature="analytics">
                <h2 class="craft-section-title">Analytics</h2>
                <div class="craft-card">
                    <div class="craft-price-grid">
                        <div class="craft-price-item">
                            <div class="craft-price-label">Volume</div>
                            <div class="craft-price-value">$12.5K</div>
                        </div>
                        <div class="craft-price-item">
                            <div class="craft-price-label">Trades</div>
                            <div class="craft-price-value">48</div>
                        </div>
                    </div>
                </div>
            </section>
        `,
    },
    {
        id: 'notifications',
        featureFlag: 'enableNotifications',
        render: () => `
            <section class="craft-section" data-feature="notifications">
                <h2 class="craft-section-title">Notifications</h2>
                <div class="craft-card">
                    <p style="color: var(--craft-text-secondary);">No new notifications</p>
                </div>
            </section>
        `,
    },
    {
        id: 'prices',
        render: (config, mockData) => `
            <section class="craft-section">
                <h2 class="craft-section-title">Asset Prices</h2>
                <div class="craft-card">
                    <div class="craft-price-grid">
                        ${Object.entries(mockData.assetPrices).map(([asset, price]) => `
                            <div class="craft-price-item">
                                <div class="craft-price-label">${escapeHtml(asset)}</div>
                                <div class="craft-price-value">$${price.toFixed(2)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </section>
        `,
    },
];

/**
 * Generate complete preview CSS
 */
export function generatePreviewCss(config: CustomizationConfig, viewport: ViewportClass): string {
    const cssParts = [
        generateCssVariables(config, viewport),
        generateBaseStyles(),
    ];
    
    return cssParts.join('\n\n');
}

/**
 * Generate preview HTML document
 */
export function generatePreviewHtml(
    config: CustomizationConfig,
    mockData: StellarMockData,
    viewport: ViewportClass
): string {
    const css = generatePreviewCss(config, viewport);
    
    // Generate sections based on feature flags
    const sectionsHtml = SECTIONS.map(section => {
        // Check if section should render based on feature flag
        if (section.featureFlag && !config.features[section.featureFlag]) {
            // Still render but CSS will hide it (for smooth transitions)
            return section.render(config, mockData);
        }
        return section.render(config, mockData);
    }).join('\n');
    
    const logoLetter = config.branding.appName.charAt(0).toUpperCase() || 'C';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=${getViewportWidth(viewport)}, initial-scale=1.0">
    <title>${escapeHtml(config.branding.appName)} - Preview</title>
    <style>
        ${css}
    </style>
</head>
<body>
    <div class="craft-preview-container">
        <header class="craft-header">
            <div class="craft-logo">${escapeHtml(logoLetter)}</div>
            <h1 class="craft-app-title">${escapeHtml(config.branding.appName)}</h1>
        </header>
        <main class="craft-main">
            ${sectionsHtml}
        </main>
    </div>
</body>
</html>`;
}

/**
 * Generate preview assets (fonts, icons)
 */
export function generatePreviewAssets(config: CustomizationConfig): PreviewAsset[] {
    const assets: PreviewAsset[] = [];
    
    // Add font asset if using Google Fonts
    const fontFamily = config.branding.fontFamily;
    if (fontFamily && !fontFamily.includes('system-ui') && !fontFamily.includes('Arial') && !fontFamily.includes('Helvetica')) {
        const fontUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily.replace(/\s+/g, '+'))}:wght@400;500;600;700&display=swap`;
        assets.push({
            url: fontUrl,
            type: 'font',
        });
    }
    
    // Add logo if present
    if (config.branding.logoUrl) {
        assets.push({
            url: config.branding.logoUrl,
            type: 'image',
        });
    }
    
    return assets;
}

/**
 * Transform preview input to output with HTML/CSS
 */
export function transformPreview(
    config: CustomizationConfig,
    mockData: StellarMockData,
    viewport: ViewportClass
): { html: string; css: string; assets: PreviewAsset[] } {
    return {
        html: generatePreviewHtml(config, mockData, viewport),
        css: generatePreviewCss(config, viewport),
        assets: generatePreviewAssets(config),
    };
}

// Helper functions
function hexToRgb(hex: string): string {
    const sanitized = hex.replace('#', '');
    const bigint = parseInt(sanitized.length === 3 
        ? sanitized.split('').map(c => c + c).join('') 
        : sanitized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeCssString(str: string): string {
    return str.replace(/["'\\]/g, '\\$&');
}

function getViewportWidth(viewport: ViewportClass): number {
    const widths: Record<ViewportClass, number> = {
        mobile: 375,
        tablet: 768,
        desktop: 1440,
    };
    return widths[viewport];
}

function getViewportHeight(viewport: ViewportClass): number {
    const heights: Record<ViewportClass, number> = {
        mobile: 812,
        tablet: 1024,
        desktop: 900,
    };
    return heights[viewport];
}

function getSpacingUnit(viewport: ViewportClass): number {
    const units: Record<ViewportClass, number> = {
        mobile: 8,
        tablet: 12,
        desktop: 16,
    };
    return units[viewport];
}

function getBorderRadius(viewport: ViewportClass): number {
    const radii: Record<ViewportClass, number> = {
        mobile: 8,
        tablet: 10,
        desktop: 12,
    };
    return radii[viewport];
}
