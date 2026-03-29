import { Networks } from 'stellar-sdk';
import type { StellarNetworkConfig } from '@craft/types';

export const NETWORK_PASSPHRASES = {
  mainnet: Networks.PUBLIC,
  testnet: Networks.TESTNET,
} as const;

export const HORIZON_URLS = {
  mainnet: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
} as const;

export const SOROBAN_RPC_URLS = {
  mainnet: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
  testnet: 'https://soroban-testnet.stellar.org',
} as const;

type Network = 'mainnet' | 'testnet';

function resolveNetwork(): Network {
  const raw = process.env.STELLAR_NETWORK ?? process.env.NEXT_PUBLIC_STELLAR_NETWORK;
  return raw === 'mainnet' ? 'mainnet' : 'testnet';
}

export function getNetworkConfig(network?: Network): StellarNetworkConfig {
  const net = network ?? resolveNetwork();
  return {
    network: net,
    horizonUrl: HORIZON_URLS[net],
    networkPassphrase: NETWORK_PASSPHRASES[net],
    sorobanRpcUrl: SOROBAN_RPC_URLS[net],
  };
}

/** Default config resolved from environment variables. */
export const config = {
  stellar: getNetworkConfig(),
} as const;

export default config;
