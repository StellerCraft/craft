-- Seed templates table with initial Stellar templates (idempotent: skip if already seeded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM templates) THEN
        INSERT INTO templates (
                name,
                description,
                category,
                blockchain_type,
                base_repository_url,
                preview_image_url,
                customization_schema,
                is_active
            )
        VALUES (
                'Stellar DEX',
                'A decentralized exchange for trading Stellar assets with real-time price feeds and transaction history.',
                'dex',
                'stellar',
                'https://github.com/craft-templates/stellar-dex',
                '/templates/stellar-dex-preview.png',
                '{
    "branding": {
      "appName": { "type": "string", "required": true, "default": "Stellar DEX" },
      "logoUrl": { "type": "string", "required": false },
      "primaryColor": { "type": "color", "required": true, "default": "#4f9eff" },
      "secondaryColor": { "type": "color", "required": true, "default": "#1a1f36" },
      "fontFamily": { "type": "string", "required": false, "default": "Inter" }
    },
    "features": {
      "enableCharts": { "type": "boolean", "default": true },
      "enableTransactionHistory": { "type": "boolean", "default": true },
      "enableAnalytics": { "type": "boolean", "default": false },
      "enableNotifications": { "type": "boolean", "default": false }
    },
    "stellar": {
      "network": { "type": "enum", "values": ["mainnet", "testnet"], "required": true, "default": "testnet" },
      "horizonUrl": { "type": "string", "required": true },
      "assetPairs": { "type": "array", "required": false }
    }
  }'::jsonb,
                true
            ),
            (
                'Soroban DeFi',
                'A DeFi platform built on Stellar''s Soroban smart contract platform with liquidity pools and yield farming.',
                'lending',
                'stellar',
                'https://github.com/craft-templates/soroban-defi',
                '/templates/soroban-defi-preview.png',
                '{
    "branding": {
      "appName": { "type": "string", "required": true, "default": "Soroban DeFi" },
      "logoUrl": { "type": "string", "required": false },
      "primaryColor": { "type": "color", "required": true, "default": "#4f9eff" },
      "secondaryColor": { "type": "color", "required": true, "default": "#1a1f36" },
      "fontFamily": { "type": "string", "required": false, "default": "Inter" }
    },
    "features": {
      "enableCharts": { "type": "boolean", "default": true },
      "enableTransactionHistory": { "type": "boolean", "default": true },
      "enableAnalytics": { "type": "boolean", "default": false }
    },
    "stellar": {
      "network": { "type": "enum", "values": ["mainnet", "testnet"], "required": true, "default": "testnet" },
      "horizonUrl": { "type": "string", "required": true },
      "sorobanRpcUrl": { "type": "string", "required": true },
      "contractAddresses": { "type": "object", "required": false }
    }
  }'::jsonb,
                true
            ),
            (
                'Payment Gateway',
                'Accept Stellar payments with multi-currency support, payment tracking, and invoice generation.',
                'payment',
                'stellar',
                'https://github.com/craft-templates/payment-gateway',
                '/templates/payment-gateway-preview.png',
                '{
    "branding": {
      "appName": { "type": "string", "required": true, "default": "Payment Gateway" },
      "logoUrl": { "type": "string", "required": false },
      "primaryColor": { "type": "color", "required": true, "default": "#4f9eff" },
      "secondaryColor": { "type": "color", "required": true, "default": "#1a1f36" },
      "fontFamily": { "type": "string", "required": false, "default": "Inter" }
    },
    "features": {
      "enableTransactionHistory": { "type": "boolean", "default": true },
      "enableAnalytics": { "type": "boolean", "default": true },
      "enableNotifications": { "type": "boolean", "default": true }
    },
    "stellar": {
      "network": { "type": "enum", "values": ["mainnet", "testnet"], "required": true, "default": "testnet" },
      "horizonUrl": { "type": "string", "required": true },
      "assetPairs": { "type": "array", "required": false }
    }
  }'::jsonb,
                true
            ),
            (
                'Asset Issuance',
                'Create and manage custom Stellar assets with distribution management and trustline configuration.',
                'asset-issuance',
                'stellar',
                'https://github.com/craft-templates/asset-issuance',
                '/templates/asset-issuance-preview.png',
                '{
    "branding": {
      "appName": { "type": "string", "required": true, "default": "Asset Issuance" },
      "logoUrl": { "type": "string", "required": false },
      "primaryColor": { "type": "color", "required": true, "default": "#4f9eff" },
      "secondaryColor": { "type": "color", "required": true, "default": "#1a1f36" },
      "fontFamily": { "type": "string", "required": false, "default": "Inter" }
    },
    "features": {
      "enableTransactionHistory": { "type": "boolean", "default": true },
      "enableAnalytics": { "type": "boolean", "default": true }
    },
    "stellar": {
      "network": { "type": "enum", "values": ["mainnet", "testnet"], "required": true, "default": "testnet" },
      "horizonUrl": { "type": "string", "required": true }
    }
  }'::jsonb,
                true
            );
    END IF;
END $$;

-- rollback: DELETE FROM templates;