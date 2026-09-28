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

This template uses Soroban RPC to interact with smart contracts on the Stellar network. Its `src/lib/config.ts` exposes a `contracts` object for platform-provided smart contract addresses.

### Contract-address injection

The template-facing injection contract is a named property under
`config.contracts`. Each configured contract-address key and value must be
materialized as a property with the same name and value. Template authors should
use that key in code rather than adding per-contract environment variables or
`{{PLACEHOLDER}}` tokens. The runtime wiring that populates this object is
tracked separately.

To add a `stakingPool` slot, include it in the customization input:

```ts
const customization = {
	stellar: {
		contractAddresses: {
			stakingPool: '<staking pool contract address>',
		},
	},
};
```

The generated `src/lib/config.ts` should expose the named value as:

```ts
contracts: {
	stakingPool: '<staking pool contract address>',
}
```

The template can then use the injected slot directly:

```ts
import { config } from '@/lib/config';

const stakingPoolAddress = config.contracts.stakingPool;
```

Keep the same lower-camel-case slot name from the customization input through
to `config.contracts` and its call sites. The runtime injection implementation
must populate this object from the configured addresses.
