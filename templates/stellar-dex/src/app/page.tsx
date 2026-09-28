'use client';

import { useState, useEffect } from 'react';
import { config } from '@/lib/config';

interface OrderBookData {
    bids: Array<{ price: string; amount: string }>;
    asks: Array<{ price: string; amount: string }>;
}

export default function Home() {
    const [orderBook, setOrderBook] = useState<OrderBookData>({ bids: [], asks: [] });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let isMounted = true;

        async function fetchOrderBook() {
            setLoading(true);
            try {
                const endpoint = config.stellar.horizonUrl.replace(/\/+$/, '');
                const res = await fetch(`${endpoint}/order_book?selling_asset_type=native&buying_asset_type=credit_alphanum4&buying_asset_code=USDC&buying_asset_issuer=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`);
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted) {
                        setOrderBook({ bids: data.bids || [], asks: data.asks || [] });
                    }
                }
            } catch (err) {
                // Ignore network errors in polling
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        }

        fetchOrderBook();
        const intervalId = setInterval(fetchOrderBook, 10000);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [config.stellar, config.stellar.network, config.stellar.horizonUrl, config.stellar.sorobanRpcUrl]);

    return (
        <main className="min-h-screen p-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-bold mb-4" style={{ color: 'var(--primary-color)' }}>
                    {config.branding.appName}
                </h1>
                <p className="text-lg text-gray-600 mb-8">
                    Decentralized exchange powered by Stellar
                </p>

                <div className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-2xl font-semibold mb-4">Swap Tokens</h2>
                    <p className="text-gray-600">
                        Connect your wallet to start trading on the Stellar network.
                    </p>

                    <div className="mt-6 p-4 rounded" style={{ backgroundColor: config.branding.secondaryColor + '20' }}>
                        <p className="text-sm" style={{ color: config.branding.secondaryColor }}>
                            Network: <strong>{config.stellar.network}</strong>
                        </p>
                        <p className="text-sm" style={{ color: config.branding.secondaryColor }}>
                            Horizon: <strong>{config.stellar.horizonUrl}</strong>
                        </p>
                    </div>

                    <div className="mt-6 p-4 border rounded" data-testid="order-book-component">
                        <h3 className="text-lg font-medium mb-2">Order Book ({config.stellar.network})</h3>
                        {loading && orderBook.bids.length === 0 && orderBook.asks.length === 0 ? (
                            <p className="text-sm text-gray-500">Loading order book...</p>
                        ) : (
                            <div className="text-sm">
                                <p>Bids: {orderBook.bids.length}</p>
                                <p>Asks: {orderBook.asks.length}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
