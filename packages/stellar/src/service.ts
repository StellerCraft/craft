import { Horizon, SorobanRpc, Transaction } from 'stellar-sdk';
import { getNetworkConfig } from './config';
import { parseStellarError, formatError } from './errors';
import type { StellarNetworkConfig } from '@craft/types';

type Network = 'mainnet' | 'testnet';

/**
 * Returns a Horizon server client for the given network.
 * Defaults to the network resolved from environment variables.
 */
export function getHorizonClient(network?: Network): Horizon.Server {
  const { horizonUrl } = getNetworkConfig(network);
  return new Horizon.Server(horizonUrl);
}

/**
 * Returns a Soroban RPC client for the given network.
 * Defaults to the network resolved from environment variables.
 */
export function getSorobanClient(network?: Network): SorobanRpc.Server {
  const { sorobanRpcUrl } = getNetworkConfig(network);
  if (!sorobanRpcUrl) {
    throw new Error(`No Soroban RPC URL configured for network: ${network}`);
  }
  return new SorobanRpc.Server(sorobanRpcUrl);
}

/**
 * Returns both Horizon and Soroban clients together with the resolved config.
 */
export function getNetworkClients(network?: Network): {
  horizon: Horizon.Server;
  soroban: SorobanRpc.Server;
  config: StellarNetworkConfig;
} {
  const cfg = getNetworkConfig(network);
  return {
    horizon: new Horizon.Server(cfg.horizonUrl),
    soroban: new SorobanRpc.Server(cfg.sorobanRpcUrl!),
    config: cfg,
  };
}

// Default server instance (resolved from env at module load)
export const server = getHorizonClient();
export const networkPassphrase = getNetworkConfig().networkPassphrase;

export async function loadAccount(publicKey: string, network?: Network) {
  try {
    return await getHorizonClient(network).loadAccount(publicKey);
  } catch (error) {
    const parsed = parseStellarError(error);
    throw new Error(
      `Failed to load account: ${parsed.message}\n${formatError(error, true)}`
    );
  }
}

export async function getAccountBalance(publicKey: string, network?: Network) {
  try {
    const account = await loadAccount(publicKey, network);
    return account.balances;
  } catch (error) {
    const parsed = parseStellarError(error);
    throw new Error(
      `Failed to get account balance: ${parsed.message}\n${formatError(error, true)}`
    );
  }
}

export async function submitTransaction(transaction: Transaction, network?: Network) {
  try {
    return await getHorizonClient(network).submitTransaction(transaction);
  } catch (error) {
    const parsed = parseStellarError(error, (transaction as any).hash);
    throw new Error(
      `Failed to submit transaction: ${parsed.message}\n${formatError(error, true)}`
    );
  }
}
