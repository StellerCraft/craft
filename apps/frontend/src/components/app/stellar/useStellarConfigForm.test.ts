import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStellarConfigForm } from './useStellarConfigForm';
import type { StellarConfig, AssetPair } from '@craft/types';

describe('useStellarConfigForm dirty-state detection', () => {
    const pairA: AssetPair = {
        base: { code: 'XLM', issuer: '', type: 'native' },
        counter: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', type: 'credit_alphanum4' },
    };

    const pairB: AssetPair = {
        base: { code: 'BTC', issuer: 'GBSTRH4QOTWNSVA6E42ACIFDVEX2CLNDYY22MGIGVRQH3CDYFD5WWSYO', type: 'credit_alphanum4' },
        counter: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', type: 'credit_alphanum4' },
    };

    const initialConfig: StellarConfig = {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        assetPairs: [pairA, pairB],
        contractAddresses: {
            dex: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
            token: 'CBBOY5K2CVQZDFJ6LPAVR5HCHETZJ64KGX23YOGZJ6LFA4N6QZ2PAAAA',
        },
    };

    it('initializes with isDirty false', () => {
        const { result } = renderHook(() => useStellarConfigForm(initialConfig));
        expect(result.current.isDirty).toBe(false);
    });

    describe('independent field dirty transitions', () => {
        it('tracks dirty state on network change and reversion', () => {
            const { result } = renderHook(() => useStellarConfigForm(initialConfig));

            act(() => {
                result.current.setField('network', 'mainnet');
            });
            expect(result.current.isDirty).toBe(true);

            act(() => {
                result.current.setField('network', 'testnet');
            });
            expect(result.current.isDirty).toBe(false);
        });

        it('tracks dirty state on horizonUrl change and reversion', () => {
            const { result } = renderHook(() => useStellarConfigForm(initialConfig));

            act(() => {
                result.current.setField('horizonUrl', 'https://horizon.stellar.org');
            });
            expect(result.current.isDirty).toBe(true);

            act(() => {
                result.current.setField('horizonUrl', 'https://horizon-testnet.stellar.org');
            });
            expect(result.current.isDirty).toBe(false);
        });

        it('tracks dirty state on sorobanRpcUrl change and reversion', () => {
            const { result } = renderHook(() => useStellarConfigForm(initialConfig));

            act(() => {
                result.current.setField('sorobanRpcUrl', 'https://soroban.stellar.org');
            });
            expect(result.current.isDirty).toBe(true);

            act(() => {
                result.current.setField('sorobanRpcUrl', 'https://soroban-testnet.stellar.org');
            });
            expect(result.current.isDirty).toBe(false);
        });

        it('tracks dirty state on assetPairs change and reversion', () => {
            const { result } = renderHook(() => useStellarConfigForm(initialConfig));

            act(() => {
                result.current.setAssetPairs([pairA]);
            });
            expect(result.current.isDirty).toBe(true);

            act(() => {
                result.current.setAssetPairs([pairA, pairB]);
            });
            expect(result.current.isDirty).toBe(false);
        });

        it('tracks dirty state on contractAddresses change and reversion', () => {
            const { result } = renderHook(() => useStellarConfigForm(initialConfig));

            act(() => {
                result.current.setContractAddress('dex', 'CCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM');
            });
            expect(result.current.isDirty).toBe(true);

            act(() => {
                result.current.setContractAddress('dex', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM');
            });
            expect(result.current.isDirty).toBe(false);

            act(() => {
                result.current.removeContractAddress('token');
            });
            expect(result.current.isDirty).toBe(true);

            act(() => {
                result.current.setContractAddress('token', 'CBBOY5K2CVQZDFJ6LPAVR5HCHETZJ64KGX23YOGZJ6LFA4N6QZ2PAAAA');
            });
            expect(result.current.isDirty).toBe(false);
        });
    });

    describe('key and order sensitivity in JSON.stringify comparisons', () => {
        it('reports dirty when assetPairs are reordered due to JSON.stringify array order sensitivity', () => {
            const { result } = renderHook(() => useStellarConfigForm(initialConfig));

            // Reorder pairs without changing items
            act(() => {
                result.current.setAssetPairs([pairB, pairA]);
            });
            // JSON.stringify-based array comparison is order sensitive
            expect(result.current.isDirty).toBe(true);

            // Reverting the order clears dirty
            act(() => {
                result.current.setAssetPairs([pairA, pairB]);
            });
            expect(result.current.isDirty).toBe(false);
        });

        it('evaluates contractAddresses key-insertion order sensitivity in JSON.stringify', () => {
            const { result } = renderHook(() => useStellarConfigForm(initialConfig));

            // Re-inserting keys in reverse order in an object:
            act(() => {
                // Delete dex, re-add dex so key enumeration order changes: token first, then dex
                result.current.removeContractAddress('dex');
                result.current.setContractAddress('dex', 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM');
            });

            // JSON.stringify({ token: ..., dex: ... }) !== JSON.stringify({ dex: ..., token: ... })
            expect(result.current.isDirty).toBe(
                JSON.stringify(result.current.state.contractAddresses) !==
                JSON.stringify(initialConfig.contractAddresses)
            );
        });
    });

    describe('reset interaction with isDirty', () => {
        it('clears dirty state and resets state back to initial on reset()', () => {
            const { result } = renderHook(() => useStellarConfigForm(initialConfig));

            act(() => {
                result.current.setField('network', 'mainnet');
                result.current.setField('horizonUrl', 'https://custom-horizon.example.com');
                result.current.setField('sorobanRpcUrl', 'https://custom-rpc.example.com');
                result.current.setAssetPairs([]);
                result.current.removeContractAddress('dex');
            });

            expect(result.current.isDirty).toBe(true);

            act(() => {
                result.current.reset();
            });

            expect(result.current.isDirty).toBe(false);
            expect(result.current.state).toEqual(initialConfig);
        });
    });
});
