import * as StellarSdk from 'stellar-sdk';
import { config } from './config';

// Initialize Stellar Server
export const server = new StellarSdk.Server(config.stellar.horizonUrl);

// Network configuration
export const networkPassphrase = config.stellar.networkPassphrase;

// Extract Horizon result codes from Stellar SDK error for structured error handling.
export function getResultCodes(error: unknown): Record<string, unknown> | null {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as Record<string, unknown>).response;
    if (response && typeof response === 'object' && 'data' in response) {
      const data = (response as Record<string, unknown>).data;
      if (data && typeof data === 'object' && 'extras' in data) {
        return ((data as Record<string, unknown>).extras as Record<string, unknown>) || null;
      }
    }
  }
  return null;
}

// Helper to create a Stellar account
export async function loadAccount(publicKey: string) {
    try {
        return await server.loadAccount(publicKey);
    } catch (error) {
        throw new Error(
            `Failed to load account: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        );
    }
}

// Helper to get account balance
export async function getAccountBalance(publicKey: string) {
    try {
        const account = await loadAccount(publicKey);
        return account.balances;
    } catch (error) {
        throw new Error(
            `Failed to get account balance: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        );
    }
}

// Helper to submit transaction
export async function submitTransaction(transaction: StellarSdk.Transaction) {
    try {
        return await server.submitTransaction(transaction);
    } catch (error) {
        throw new Error(
            `Failed to submit transaction: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        );
    }
}
