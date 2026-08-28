# Soroban DeFi Template

A DeFi application template built on Stellar's Soroban smart contract platform.

## Features

- Smart contract interactions
- Liquidity pools
- Yield farming
- Wallet integration
- Customizable branding

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Configuration

This template is configured via environment variables. See `.env.example` for available options.

### Environment Variables

- **NEXT_PUBLIC_STELLAR_NETWORK**: The Stellar network to use (`mainnet` or `testnet`)
- **NEXT_PUBLIC_HORIZON_URL**: The Horizon API endpoint URL for Stellar operations
- **NEXT_PUBLIC_SOROBAN_RPC_URL**: The Soroban RPC endpoint URL for smart contract interactions
- **NEXT_PUBLIC_NETWORK_PASSPHRASE**: The network passphrase for transaction signing
- **NEXT_PUBLIC_APP_NAME**: The application name for branding
- **NEXT_PUBLIC_PRIMARY_COLOR**: Primary color for the UI (hex format, e.g., `#4f9eff`)
- **NEXT_PUBLIC_SECONDARY_COLOR**: Secondary color for the UI (hex format, e.g., `#1a1f36`)

## Soroban Integration

This template uses Soroban RPC to interact with smart contracts on the Stellar network. Smart contract addresses are injected into the `src/lib/config.ts` during deployment by the CRAFT platform.
