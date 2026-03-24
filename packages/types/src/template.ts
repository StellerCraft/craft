export type TemplateCategory = 'dex' | 'lending' | 'payment' | 'asset-issuance';

export interface Template {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
    blockchainType: 'stellar';
    baseRepositoryUrl: string;
    previewImageUrl: string;
    features: TemplateFeature[];
    customizationSchema: CustomizationSchema;
    isActive: boolean;
    createdAt: Date;
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
    search?: string;
    blockchainType?: 'stellar';
}

export interface TemplateMetadata {
    id: string;
    name: string;
    version: string;
    lastUpdated: Date;
    totalDeployments: number;
}
