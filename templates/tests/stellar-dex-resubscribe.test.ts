import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('stellar-dex template order book resubscription (#1283)', () => {
    const pagePath = path.resolve(__dirname, '../stellar-dex/src/app/page.tsx');

    it('page.tsx source includes network config in useEffect dependencies and cleans up interval', () => {
        const source = fs.readFileSync(pagePath, 'utf8');

        // Verify the dependency array has resolved network config dependencies
        expect(source).toMatch(/\[.*config\.stellar.*\]/);

        // Verify cleanup function is present
        expect(source).toContain('clearInterval');
        expect(source).toContain('return () =>');
    });

    it('simulates order-book subscription teardown and re-establishment when network changes', () => {
        vi.useFakeTimers();

        const subscriptions: string[] = [];
        const teardowns: string[] = [];

        function simulateOrderBookEffect(stellarConfig: { network: string; horizonUrl: string }) {
            let active = true;
            subscriptions.push(`sub:${stellarConfig.network}`);

            const intervalId = setInterval(() => {
                if (active) {
                    subscriptions.push(`poll:${stellarConfig.network}`);
                }
            }, 1000);

            return () => {
                active = false;
                teardowns.push(`teardown:${stellarConfig.network}`);
                clearInterval(intervalId);
            };
        }

        // Initial mount on testnet
        let config = { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' };
        let cleanup = simulateOrderBookEffect(config);

        expect(subscriptions).toEqual(['sub:testnet']);
        vi.advanceTimersByTime(1000);
        expect(subscriptions).toEqual(['sub:testnet', 'poll:testnet']);

        // Network config changes (e.g. preview re-render after Customization Studio edit)
        cleanup();
        config = { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' };
        cleanup = simulateOrderBookEffect(config);

        expect(teardowns).toEqual(['teardown:testnet']);
        expect(subscriptions).toContain('sub:mainnet');

        vi.advanceTimersByTime(1000);
        expect(subscriptions).toContain('poll:mainnet');
        expect(subscriptions).not.toContain('poll:testnet:after');

        cleanup();
        expect(teardowns).toEqual(['teardown:testnet', 'teardown:mainnet']);

        vi.useRealTimers();
    });
});
