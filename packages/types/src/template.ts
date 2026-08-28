export type TemplateCategory = 'dex' | 'lending' | 'payment' | 'asset-issuance';

export interface Template {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
    blockchainType: 'stellar';
    baseRepositoryUrl: string;
    previewImageUrl: string;
    /** Keyword tags used for full-text search and discovery. */
    tags: string[];
    features: TemplateFeature[];
    customizationSchema: CustomizationSchema;
    isActive: boolean;
    createdAt: Date;
    /** ts_rank relevance score — present when returned from searchTemplates(). */
    relevanceScore?: number;
}

export interface TemplateFeature {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    configurable: boolean;
}

export interface CustomizationSchema {
    branding: BrandingOptions;
    features: FeatureToggles;
    stellar: StellarConfiguration;
}

export interface BrandingOptions {
    appName: { type: 'string'; required: boolean };
    logoUrl?: { type: 'string'; required: boolean };
    primaryColor: { type: 'color'; required: boolean };
    secondaryColor: { type: 'color'; required: boolean };
    fontFamily: { type: 'string'; required: boolean };
}

export interface FeatureToggles {
    enableCharts: { type: 'boolean'; default: boolean };
    enableTransactionHistory: { type: 'boolean'; default: boolean };
    enableAnalytics: { type: 'boolean'; default: boolean };
    enableNotifications: { type: 'boolean'; default: boolean };
}

export interface StellarConfiguration {
    network: { type: 'enum'; values: ['mainnet', 'testnet']; required: true };
    horizonUrl: { type: 'string'; required: true };
    sorobanRpcUrl: { type: 'string'; required: false };
    assetPairs: { type: 'array'; required: false };
}

export interface TemplateFilters {
    category?: TemplateCategory;
    /** Legacy ilike search — kept for backward compatibility. */
    search?: string;
    blockchainType?: 'stellar';
    /** Full-text search query (phrase / prefix / keyword). Takes precedence over `search`. */
    q?: string;
}

export interface TemplateMetadata {
    id: string;
    name: string;
    version: string;
    lastUpdated: Date;
    totalDeployments: number;
}
