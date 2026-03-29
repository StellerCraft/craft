import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getNetworkConfig,
  HORIZON_URLS,
  NETWORK_PASSPHRASES,
  SOROBAN_RPC_URLS,
} from './config';
import { getHorizonClient, getSorobanClient, getNetworkClients } from './service';

describe('getNetworkConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns testnet config by default', () => {
    const cfg = getNetworkConfig('testnet');
    expect(cfg.network).toBe('testnet');
    expect(cfg.horizonUrl).toBe(HORIZON_URLS.testnet);
    expect(cfg.networkPassphrase).toBe(NETWORK_PASSPHRASES.testnet);
    expect(cfg.sorobanRpcUrl).toBe(SOROBAN_RPC_URLS.testnet);
  });

  it('returns mainnet config when explicitly requested', () => {
    const cfg = getNetworkConfig('mainnet');
    expect(cfg.network).toBe('mainnet');
    expect(cfg.horizonUrl).toBe(HORIZON_URLS.mainnet);
    expect(cfg.networkPassphrase).toBe(NETWORK_PASSPHRASES.mainnet);
    expect(cfg.sorobanRpcUrl).toBe(SOROBAN_RPC_URLS.mainnet);
  });

  it('resolves mainnet from STELLAR_NETWORK env var', () => {
    vi.stubEnv('STELLAR_NETWORK', 'mainnet');
    const cfg = getNetworkConfig();
    expect(cfg.network).toBe('mainnet');
    expect(cfg.horizonUrl).toBe(HORIZON_URLS.mainnet);
  });

  it('resolves testnet from STELLAR_NETWORK env var', () => {
    vi.stubEnv('STELLAR_NETWORK', 'testnet');
    const cfg = getNetworkConfig();
    expect(cfg.network).toBe('testnet');
  });

  it('falls back to testnet for unknown STELLAR_NETWORK values', () => {
    vi.stubEnv('STELLAR_NETWORK', 'invalid');
    const cfg = getNetworkConfig();
    expect(cfg.network).toBe('testnet');
  });

  it('explicit network argument takes precedence over env var', () => {
    vi.stubEnv('STELLAR_NETWORK', 'mainnet');
    const cfg = getNetworkConfig('testnet');
    expect(cfg.network).toBe('testnet');
  });
});

describe('getHorizonClient', () => {
  it('returns a Horizon.Server instance for testnet', () => {
    const client = getHorizonClient('testnet');
    expect(client).toBeDefined();
    expect(typeof client.loadAccount).toBe('function');
  });

  it('returns a Horizon.Server instance for mainnet', () => {
    const client = getHorizonClient('mainnet');
    expect(client).toBeDefined();
    expect(typeof client.loadAccount).toBe('function');
  });
});

describe('getSorobanClient', () => {
  it('returns a SorobanRpc.Server instance for testnet', () => {
    const client = getSorobanClient('testnet');
    expect(client).toBeDefined();
  });

  it('returns a SorobanRpc.Server instance for mainnet', () => {
    const client = getSorobanClient('mainnet');
    expect(client).toBeDefined();
  });
});

describe('getNetworkClients', () => {
  it('returns horizon, soroban, and config together', () => {
    const { horizon, soroban, config } = getNetworkClients('testnet');
    expect(horizon).toBeDefined();
    expect(soroban).toBeDefined();
    expect(config.network).toBe('testnet');
  });
});
